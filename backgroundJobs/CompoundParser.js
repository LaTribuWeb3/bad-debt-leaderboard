const Web3 = require('web3')
const { toBN, toWei, fromWei } = Web3.utils
const axios = require('axios')
const Addresses = require("./Addresses.js")
const { getPrice, getEthPrice, getCTokenPriceFromZapper } = require('./priceFetcher')
const User = require("./User.js")
const {waitForCpuToGoBelowThreshold} = require("../machineResources")
const {retry, loadUserListFromDisk, saveUserListToDisk, sleep, generateMonitoringJSON, deleteUserDataFile, appendToUserDataFile, getUserDataReadlineInterface, updateUserDataFile} = require("../utils")
const { uploadMonitoringJsonFile } = require('../githubClient.js')

let LOAD_USERS_FROM_DISK = process.env.LOAD_USER_FROM_DISK && process.env.LOAD_USER_FROM_DISK.toLowerCase() == 'true';

class Compound {
    /**
     * build a compound parser
     * @param {*} compoundInfo addresses and other informations about the protocol
     * @param {string} network the name of the network, must be the same as in the indexkey in compoundInfo
     * @param {Web3} web3 web3 connector
     * @param {number} heavyUpdateInterval defines the amount of fetch between two heavy updates
     * @param {number} fetchDelayInHours defines the delay between 2 fetch, in hours
     * @param {string} userFileName defines the user file name, if any
     */
    constructor(compoundInfo, network, web3, heavyUpdateInterval = 24, fetchDelayInHours = 1, userFileName = null, runnerName = 'defaultCompoundRunner', userDataFileName = null) {
      this.web3 = web3
      this.network = network
      this.comptroller = new web3.eth.Contract(Addresses.comptrollerAbi, compoundInfo[network].comptroller)

      this.cETHAddresses = [compoundInfo[network].cETH]
      if(compoundInfo[network].cETH2) this.cETHAddresses.push(compoundInfo[network].cETH2)

      this.nonBorrowableMarkets = []
      if(compoundInfo[network].nonBorrowableMarkets) this.nonBorrowableMarkets = compoundInfo[network].nonBorrowableMarkets

      this.rektMarkets = []
      if(compoundInfo[network].rektMarkets) this.rektMarkets = compoundInfo[network].rektMarkets

      this.priceOracle = new web3.eth.Contract(Addresses.oneInchOracleAbi, Addresses.oneInchOracleAddress[network])
      this.multicall = new web3.eth.Contract(Addresses.multicallAbi, Addresses.multicallAddress[network])
      this.usdcAddress = Addresses.usdcAddress[network]
      this.deployBlock = compoundInfo[network].deployBlock
      this.blockStepInInit = compoundInfo[network].blockStepInInit
      this.multicallSize = compoundInfo[network].multicallSize

      this.prices = {}
      this.markets = []
      this.users = {}
      this.userList = []

      this.sumOfBadDebt = web3.utils.toBN("0")
      this.lastUpdateBlock = 0

      this.mainCntr = 0
      this.usdcDecimals = 6
      this.heavyUpdateInterval = heavyUpdateInterval

      this.tvl = toBN("0")
      this.totalBorrows = toBN("0")

      this.output = {}
      this.fetchDelayInHours = fetchDelayInHours;
      this.userFileName = userFileName;
      if(this.userFileName == undefined) {
        LOAD_USERS_FROM_DISK = false;
      }
      this.runnerName = runnerName;
      this.runnerFileName = runnerName.split(' ').join('-') + '.json';
      this.userDataFileName = userDataFileName;
    }

    async heavyUpdate() {
        if(this.userList.length == 0
            // if LOAD_USERS_FROM_DISK, collect all users each time heavy update is called 
            // even is there is already some user in the user list
            // it does not take too much time to fetch new users that way
            || LOAD_USERS_FROM_DISK) {
            await this.collectAllUsers();
        }

        await this.updateAllUsers()
    }

    async lightUpdate() {
        await this.periodicUpdateUsers(this.lastUpdateBlock)
    }

    async updateMonitoringFile(status, error) {
        await uploadMonitoringJsonFile(generateMonitoringJSON(this.runnerName, status, this.lastStart, this.lastEnd, this.lastDuration, this.lastUpdateBlock, error), this.runnerFileName);
    }

    async main() {
        try {
            this.lastStart = Math.round(Date.now() / 1000);
            await this.updateMonitoringFile('running', null);
            await waitForCpuToGoBelowThreshold()
            const fnInitPrice = (...args) => this.initPrices(...args);
            await retry(fnInitPrice, [])
                        
            const currBlock = await retry(this.web3.eth.getBlockNumber, []) - 10
            const currTime = (await retry(this.web3.eth.getBlock, [currBlock])).timestamp

            const usdcContract = new this.web3.eth.Contract(Addresses.cTokenAbi, this.usdcAddress)
            this.usdcDecimals = Number(await usdcContract.methods.decimals().call())
            console.log("usdc decimals", this.usdcDecimals)
            if(this.mainCntr % this.heavyUpdateInterval == 0) {
                console.log("heavyUpdate start")
                await this.heavyUpdate()
                console.log('heavyUpdate success')
            } else {
                console.log("lightUpdate start")
                await this.lightUpdate()
                console.log('lightUpdate success')
            }
            console.log("calc bad debt")
            await this.calcBadDebt(currTime)
            
            this.lastUpdateBlock = currBlock
            this.lastEnd = Math.round(Date.now() / 1000);
            this.lastDuration = this.lastEnd - this.lastStart;
            await this.updateMonitoringFile('success', null);

            // don't  increase cntr, this way if heavy update is needed, it will be done again next time
            console.log("sleeping", this.mainCntr++)
        }
        catch(err) {
            console.log("main failed", {err})
            await this.updateMonitoringFile('error', err);
        }

        setTimeout(this.main.bind(this), this.fetchDelayInHours * 3600 * 1000) // sleep for 'this.fetchDelayInHours' hour
    }

    async getFallbackPrice(market) {
        return toBN("0") // todo - override in each market
    }

    async initPrices() {
        console.log("get markets")
        this.markets = await retry(this.comptroller.methods.getAllMarkets().call, []);
        console.log(this.markets)

        let tvl = toBN("0")
        let totalBorrows = toBN("0")

        for(const market of this.markets) {
            let price
            let balance
            let borrows
            console.log({market})
            const ctoken = new this.web3.eth.Contract(Addresses.cTokenAbi, market)

            if(this.cETHAddresses.includes(market)) {
                price = await getEthPrice(this.network)
                balance = await retry(this.web3.eth.getBalance, [market]);
            }
            else {
                console.log("getting underlying")
                const underlying = await retry(ctoken.methods.underlying().call, []);
                price = await getPrice(this.network, underlying, this.web3)
                if(price.toString() == "0" && this.network === "ETH") {
                    console.log("trying with zapper")
                    price = await getCTokenPriceFromZapper(market, underlying, this.web3, this.network)
                }
                if(price.toString() === "0"){  // test and handle price is zero 
                    // we should not get here but if we do the process exits 
                    // & so bad debt will not be calulated without a real price
                    console.log({ 
                        underlying, 
                        price, 
                        message: "no price was obtained"
                    })

                }
                const token = new this.web3.eth.Contract(Addresses.cTokenAbi, underlying)
                balance = await retry(token.methods.balanceOf(market).call, []);
            }

            if(price.toString() === "0") {
                price = await this.getFallbackPrice(market)
            }
            
            this.prices[market] = this.web3.utils.toBN(price)
            console.log(market, price.toString())

            if(this.nonBorrowableMarkets.includes(market)) {
                borrows = toBN("0")
            }
            else {
                borrows = await retry(ctoken.methods.totalBorrows().call, []);
            }

            const _1e18 = toBN(toWei("1"))
            tvl = tvl.add((toBN(balance)).mul(toBN(price)).div(_1e18))
            totalBorrows = totalBorrows.add((toBN(borrows)).mul(toBN(price)).div(_1e18))
        }

        this.tvl = tvl
        this.totalBorrows = totalBorrows

        console.log("init prices: tvl ", fromWei(tvl.toString()), " total borrows ", fromWei(this.totalBorrows.toString()))
    }


    async getPastEventsInSteps(cToken, key, from, to){
        let totalEvents = []
        for (let i = from; i < to; i = i + this.blockStepInInit) {
            const fromBlock = i
            const toBlock = i + this.blockStepInInit > to ? to : i + this.blockStepInInit
            console.log(`getPastEventsInSteps: Getting events ${key} from ${fromBlock} to ${toBlock}`);
            const fn = (...args) => cToken.getPastEvents(...args)
            const events = await retry(fn, [key, {fromBlock, toBlock}])
            totalEvents = totalEvents.concat(events)
        }
        return totalEvents
    }

    async periodicUpdateUsers(lastUpdatedBlock) {
        const accountsToUpdate = []
        const newUsers = [];
        const currBlock = await this.web3.eth.getBlockNumber() - 10
        console.log({currBlock})

        const events = {"Mint" : ["minter"],
                        "Redeem" : ["redeemer"],
                        "Borrow" : ["borrower"],
                        "RepayBorrow" : ["borrower"],
                        "LiquidateBorrow" : ["liquidator","borrower"],
                        "Transfer" : ["from", "to"] }

        for(const market of this.markets) {
            const ctoken = new this.web3.eth.Contract(Addresses.cTokenAbi, market)
            const keys = Object.keys(events)
            console.log({keys})
            for (const key of keys) {
                const value = events[key]
                console.log({key}, {value})
                const newEvents = await this.getPastEventsInSteps(ctoken, key, lastUpdatedBlock, currBlock) 
                for(const e of newEvents) {
                    for(const field of value) {
                        console.log({field})
                        const a = e.returnValues[field]
                        console.log({a})
                        if(! accountsToUpdate.includes(a)) accountsToUpdate.push(a)
                    }
                }
            }
        }

        console.log({accountsToUpdate})
        for(const a of accountsToUpdate) {
            if(! this.userList.includes(a)) {
                this.userList.push(a)
                // save the new users to differenciate between old user that will need to be updated
                // and the new users that will just need to be appended to the user data file
                newUsers.push(a);
            }
        }
        // updating users in slices
        const bulkSize = this.multicallSize;
        let userDataToUpdate = {};
        for (let i = 0; i < accountsToUpdate.length; i = i + bulkSize) {
            const to = i + bulkSize > accountsToUpdate.length ? accountsToUpdate.length : i + bulkSize
            const slice = accountsToUpdate.slice(i, to)
            const fn = (...args) => this.updateUsers(...args)
            const newData = await retry(fn, [slice])
            // merge newData with userDataToUpdate
            userDataToUpdate = Object.assign({}, userDataToUpdate, newData);
        }

        await updateUserDataFile(this.userDataFileName, userDataToUpdate, newUsers);
    }

    async collectAllUsers() {
        const currBlock = await retry(this.web3.eth.getBlockNumber, []) - 10
        console.log({currBlock})
        let firstBlockToFetch = this.deployBlock - 1;

        if(LOAD_USERS_FROM_DISK) {
            const loadedValue = loadUserListFromDisk(this.userFileName)
            if(loadedValue) {
                firstBlockToFetch = loadedValue.firstBlockToFetch;
                this.userList = loadedValue.userList;
            }
        }

        let blockStep = this.blockStepInInit;

        console.log(`collectAllUsers: Will fetch users from block ${firstBlockToFetch} to block ${currBlock}. Starting user count: ${this.userList.length}`);
        for(let startBlock = firstBlockToFetch ; startBlock < currBlock ; startBlock += blockStep) {
            const endBlock = (startBlock + blockStep > currBlock) ? currBlock : startBlock + blockStep
            let events
            try {
                // Try to run this code
                events = await this.comptroller.getPastEvents("MarketEntered", {fromBlock: startBlock, toBlock:endBlock})
                if(events.code == 429) {
                    throw new Error('rate limited')
                }
                if(events == undefined) {
                    throw new Error('events undefined')
                }
            }
            catch(err) {
                // if any error, Code throws the error
                console.log("call failed, trying again", err.toString())
                startBlock -= blockStep // try again
                blockStep = blockStep / 2
                await sleep(5)
                continue
            }


            for(const e of events) {
                const a = e.returnValues.account
                if(! this.userList.includes(a)) this.userList.push(a)
            }
            console.log(`collectAllUsers: ${startBlock} -> ${endBlock}. Stepsize: ${blockStep}. Users: ${this.userList.length}`)
            blockStep = this.blockStepInInit;
        }

        if(LOAD_USERS_FROM_DISK) {
            saveUserListToDisk(this.userFileName, this.userList, currBlock)
        }
    }

    async updateAllUsers() {
        const users = this.userList //require('./my.json')
        const bulkSize = this.multicallSize

        deleteUserDataFile(this.userDataFileName);
        // delete old data file
        for(let i = 0 ; i < users.length ; i+= bulkSize) {
            const start = i
            const end = i + bulkSize > users.length ? users.length : i + bulkSize
            console.log("update", i.toString() + " / " + users.length.toString())
            try {
                const usersDataInBatch = await this.updateUsers(users.slice(start, end))
                appendToUserDataFile(this.userDataFileName, usersDataInBatch);
            }
            catch(err) {
                console.log("update user failed, trying again", err)
                i -= bulkSize
            }
        }
    }

    async additionalCollateralBalance(userAddress) {
        return this.web3.utils.toBN("0")
    }

    async calcBadDebt(currTime) {
        this.sumOfBadDebt = this.web3.utils.toBN("0")
        let deposits = this.web3.utils.toBN("0")
        let borrows = this.web3.utils.toBN("0")
        let tvl = this.web3.utils.toBN("0")

        const userWithBadDebt = []

        const userDataReadlineAccessor = getUserDataReadlineInterface(this.userDataFileName);

        let firstLine = true;
        for await (const line of userDataReadlineAccessor.readlineInterface) {
            if(firstLine) {
                firstLine = false;
                continue;
            }

            const user = line.split(';')[0];
            const dataJson = line.split(';')[1];
            const data = JSON.parse(dataJson);

            const userData = new User(user, data.marketsIn, data.borrowBalance, data.collateralBalace, data.error)
            //console.log({user})
            const additionalCollateral = await this.additionalCollateralBalance(user)
            const userValue = userData.getUserNetValue(this.web3, this.prices)

            //console.log("XXX", user, userValue.collateral.toString(), additionalCollateral.toString())
            deposits = deposits.add(userValue.collateral).add(additionalCollateral)
            borrows = borrows.add(userValue.debt)

            const netValue = this.web3.utils.toBN(userValue.netValue).add(additionalCollateral)
            tvl = tvl.add(netValue).add(additionalCollateral)

            if(this.web3.utils.toBN(netValue).lt(this.web3.utils.toBN("0"))) {
                //const result = await this.comptroller.methods.getAccountLiquidity(user).call()
                console.log("bad debt for user", user, Number(netValue.toString())/1e6/*, {result}*/)
                this.sumOfBadDebt = this.sumOfBadDebt.add(this.web3.utils.toBN(netValue))

                console.log("total bad debt", Number(this.sumOfBadDebt.toString()) / 1e6)
                
                userWithBadDebt.push({"user" : user, "badDebt" : netValue.toString()})
            }
        }
        // at the end, close the filestream
        userDataReadlineAccessor.stream.close();

        this.output = { "total" :  this.sumOfBadDebt.toString(), "updated" : currTime.toString(), "decimals" : "18", "users" : userWithBadDebt,
                        "tvl" : this.tvl.toString(), "deposits" : deposits.toString(), "borrows" : borrows.toString(),
                        "calculatedBorrows" : this.totalBorrows.toString()}

        console.log(JSON.stringify(this.output))

        console.log("total bad debt", this.sumOfBadDebt.toString(), {currTime})

        return this.sumOfBadDebt
    }

    async updateUsers(userAddresses) {
        // need to get: 1) user in market 2) user collateral in all markets 3) user borrow balance in all markets
        
        // market in
        const assetInCalls = []
        console.log("preparing asset in calls")
        for(const user of userAddresses) {
            const call = {}
            call["target"] = this.comptroller.options.address
            call["callData"] = this.comptroller.methods.getAssetsIn(user).encodeABI()
            assetInCalls.push(call)
        }
        const assetInResult = await this.multicall.methods.tryAggregate(false, assetInCalls).call()

        const ctoken = new this.web3.eth.Contract(Addresses.cTokenAbi)
        
        // collateral balance
        const collateralBalanceCalls = []
        const borrowBalanceCalls = []
        for(const user of userAddresses) {
            for(const market of this.markets) {
                const collatCall = {}
                const borrowCall = {}
    
                collatCall["target"] = market
                borrowCall["target"] = market
                if(this.rektMarkets.includes(market)) {
                    // encode something that will return 0
                    collatCall["callData"] = ctoken.methods.balanceOf(market).encodeABI()
                }
                else {
                    collatCall["callData"] = ctoken.methods.balanceOfUnderlying(user).encodeABI()
                }
                if(this.nonBorrowableMarkets.includes(market)) {
                    // encode something that will return 0
                    borrowCall["callData"] = ctoken.methods.balanceOf(market).encodeABI()
                }
                else {
                    borrowCall["callData"] = ctoken.methods.borrowBalanceCurrent(user).encodeABI()
                }

                collateralBalanceCalls.push(collatCall)
                borrowBalanceCalls.push(borrowCall)
            }
        }

        console.log("getting collateral balances")
        const collateralBalaceResults = await this.multicall.methods.tryAggregate(false, collateralBalanceCalls).call()
        console.log("getting borrow balances")        
        const borrowBalanceResults = await this.multicall.methods.tryAggregate(false, borrowBalanceCalls).call()

        // init class for all users
        let userIndex = 0
        let globalIndex = 0
        const usersInBatch = {};
        for(const user of userAddresses) {

            if(user == '0xDbb26dE83C17642a434BE33155cd65bA937e7D08') {
                console.log('user with error');
            }

            let success = true
            if(! assetInResult[userIndex].success) success = false
            const assetsIn = this.web3.eth.abi.decodeParameter("address[]", assetInResult[userIndex].returnData)
            userIndex++

            const borrowBalances = {}
            const collateralBalances = {}
            for(const market of this.markets) {
                if(! collateralBalaceResults[globalIndex].success) success = false
                if(! borrowBalanceResults[globalIndex].success) success = false

                const colatBal = this.web3.eth.abi.decodeParameter("uint256", collateralBalaceResults[globalIndex].returnData)
                const borrowBal = this.web3.eth.abi.decodeParameter("uint256", borrowBalanceResults[globalIndex].returnData)

                borrowBalances[market] = this.web3.utils.toBN(borrowBal)
                collateralBalances[market] = this.web3.utils.toBN(colatBal)
                
                // remove if 0, use less RAM/storage
                if(borrowBalances[market] == '0') {
                    delete borrowBalances[market];
                }

                if(collateralBalances[market] == '0') {
                    delete collateralBalances[market];
                }

                globalIndex++
            }

            const userData = new User(user, this.intersect(assetsIn, this.markets), borrowBalances, collateralBalances, ! success)

            if(success) {
                // only save user data if any borrow or collateral
                // will use less RAM/storage
                if(Object.keys(borrowBalances).length != 0
                   || Object.keys(collateralBalances).length != 0)
                usersInBatch[user] = userData
            } else {
                console.log('Error when updating user', user, JSON.stringify(userData, null, 2));
            }
        }

        return usersInBatch;
    }

    intersect(arr1, arr2) {
        const result = []
        for(const a of arr1) {
            if(arr2.includes(a)) result.push(a)
        }

        return result
    }
  }

module.exports = Compound

// async function test() {
//     const web3 = new Web3(process.env.BSC_NODE_URL)
//     const ctoken = new web3.eth.Contract(Addresses.cTokenAbi, '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8');
//     const currBlock = await web3.getBlockNumber
//     const from =  25832698 - 100000;
//     const to = from + 50000 - 1;
//     const events = await ctoken.getPastEvents("Mint", {fromBlock: from, toBlock:to})
   
//  }

//  test()

