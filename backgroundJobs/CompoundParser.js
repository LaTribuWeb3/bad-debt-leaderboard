const Web3 = require('web3');
const { toBN, toWei, fromWei } = Web3.utils;
const Addresses = require('./Addresses.js');
const { getPrice, getEthPrice, getCTokenPriceFromZapper } = require('./priceFetcher');
const User = require('./User.js');
const {waitForCpuToGoBelowThreshold} = require('../machineResources');
const {retry, loadUserListFromDisk, saveUserListToDisk} = require('../utils');
const { fetchAllEventsAndExtractStringArray, normalize } = require('../web3utils.js');

class Compound {
  /**
     * build a compound parser
     * @param {{ [network: string]: { comptroller: string; cETH: string; deployBlock: number; blockStepInInit: number; multicallSize: number;}; }} compoundInfo addresses and other informations about the protocol
     * @param {string} network the name of the network, must be the same as in the indexkey in compoundInfo
     * @param {Web3} web3 web3 connector
     * @param {number} heavyUpdateInterval defines the amount of fetch between two heavy updates
     * @param {number} fetchDelayInHours defines the delay between 2 fetch, in hours
     */
  constructor(compoundInfo, network, web3, heavyUpdateInterval = 24, fetchDelayInHours = 1) {
    this.runnerName = `${this.constructor.name}-Runner`;
    console.log(`runner name: ${this.runnerName}`);
    this.userListFileName = `${this.runnerName}-userlist.json`;
    this.web3 = web3;
    this.network = network;
    this.comptroller = new web3.eth.Contract(Addresses.comptrollerAbi, compoundInfo[network].comptroller);
    this.cptUserZeroValue = 0;

    this.cETHAddresses = [compoundInfo[network].cETH];
    if(compoundInfo[network].cETH2) this.cETHAddresses.push(compoundInfo[network].cETH2);

    this.nonBorrowableMarkets = [];
    if(compoundInfo[network].nonBorrowableMarkets) this.nonBorrowableMarkets = compoundInfo[network].nonBorrowableMarkets;

    this.rektMarkets = [];
    if(compoundInfo[network].rektMarkets) this.rektMarkets = compoundInfo[network].rektMarkets;

    this.priceOracle = new web3.eth.Contract(Addresses.oneInchOracleAbi, Addresses.oneInchOracleAddress[network]);
    this.multicall = new web3.eth.Contract(Addresses.multicallAbi, Addresses.multicallAddress[network]);
    this.usdcAddress = Addresses.usdcAddress[network];
    this.deployBlock = compoundInfo[network].deployBlock;
    this.blockStepInInit = compoundInfo[network].blockStepInInit;
    this.multicallSize = compoundInfo[network].multicallSize;

    this.prices = {};
    this.markets = [];
    this.users = {};
    this.userList = [];

    this.sumOfBadDebt = web3.utils.toBN('0');
    this.lastUpdateBlock = 0;

    this.mainCntr = 0;
    this.usdcDecimals = 6;
    this.heavyUpdateInterval = heavyUpdateInterval;

    this.tvl = toBN('0');
    this.totalBorrows = toBN('0');

    this.output = {};
    this.fetchDelayInHours = fetchDelayInHours;
    if(compoundInfo[network].blockStepLimit) {
      this.blockStepLimit = compoundInfo[network].blockStepLimit;
    } else {
      this.blockStepLimit = undefined;
    }
  }

  async heavyUpdate(currBlock) {
    await this.collectAllUsers(currBlock);
    await this.updateAllUsers();
  }

  async lightUpdate(currBlock) {
    await this.periodicUpdateUsers(this.lastUpdateBlock, currBlock);
  }

  async main() {
    try {
      this.cptUserZeroValue = 0;
      await waitForCpuToGoBelowThreshold();
      await this.initPrices();
                        
      const currBlock = await this.web3.eth.getBlockNumber() - 10;
      const currTime = (await this.web3.eth.getBlock(currBlock)).timestamp;

      const usdcContract = new this.web3.eth.Contract(Addresses.cTokenAbi, this.usdcAddress);
      this.usdcDecimals = Number(await usdcContract.methods.decimals().call());
      console.log('usdc decimals', this.usdcDecimals);
      if(this.mainCntr % this.heavyUpdateInterval == 0) {
        console.log('heavyUpdate start');
        await this.heavyUpdate(currBlock);
        console.log(`heavyUpdate success, users with 0 net value: ${this.cptUserZeroValue} / ${this.userList.length}`);
      } else {
        console.log('lightUpdate start');
        await this.lightUpdate(currBlock);
        console.log('lightUpdate success');
      }
      console.log('calc bad debt');
      await this.calcBadDebt(currTime);
            
      console.log(`bad debt: ${normalize(this.output.total, 18)}`);
      console.log(`tvl: ${normalize(this.output.tvl, 18)}`);
      this.lastUpdateBlock = currBlock;

      // don't  increase cntr, this way if heavy update is needed, it will be done again next time
      console.log('sleeping', this.mainCntr++);
    }
    catch(err) {
      console.log('main failed', {err});
    }

    setTimeout(this.main.bind(this), this.fetchDelayInHours * 3600 * 1000); // sleep for 'this.fetchDelayInHours' hour
  }

  // eslint-disable-next-line no-unused-vars
  async getFallbackPrice(market) {
    return toBN('0'); // todo - override in each market
  }

  async initPrices() {
    console.log('get markets');
    this.markets = await this.comptroller.methods.getAllMarkets().call();
    console.log(this.markets);

    let tvl = toBN('0');
    let totalBorrows = toBN('0');

    for(const market of this.markets) {
      let price;
      let balance;
      let borrows;
      console.log({market});
      const ctoken = new this.web3.eth.Contract(Addresses.cTokenAbi, market);

      if(this.cETHAddresses.includes(market)) {
        price = await getEthPrice(this.network);
        balance = await this.web3.eth.getBalance(market);
      }
      else {
        console.log('getting underlying');
        const underlying = await ctoken.methods.underlying().call();
        price = await getPrice(this.network, underlying, this.web3);
        if(price.toString() == '0' && this.network === 'ETH') {
          console.log('trying with zapper');
          price = await getCTokenPriceFromZapper(market, underlying, this.web3, this.network);
        }
        if(price.toString() === '0'){  // test and handle price is zero 
          // we should not get here but if we do the process exits 
          // & so bad debt will not be calulated without a real price
          console.log({ 
            underlying, 
            price, 
            message: 'no price was obtained'
          });

        }
        const token = new this.web3.eth.Contract(Addresses.cTokenAbi, underlying);
        balance = await token.methods.balanceOf(market).call();
      }

      if(price.toString() === '0') {
        price = await this.getFallbackPrice(market);
      }
            
      this.prices[market] = this.web3.utils.toBN(price);
      console.log(market, price.toString());

      if(this.nonBorrowableMarkets.includes(market)) {
        borrows = toBN('0');
      }
      else {
        borrows = await ctoken.methods.totalBorrows().call();
      }

      const _1e18 = toBN(toWei('1'));
      tvl = tvl.add(  (toBN(balance)).mul(toBN(price)).div(_1e18)  );
      totalBorrows = totalBorrows.add(  (toBN(borrows)).mul(toBN(price)).div(_1e18)  );
    }

    this.tvl = tvl;
    this.totalBorrows = totalBorrows;

    console.log('init prices: tvl ', fromWei(tvl.toString()), ' total borrows ', fromWei(this.totalBorrows.toString()));
  }


  // async getPastEventsInSteps(cToken, key, from, to){
  //   let totalEvents = [];
  //   for (let i = from; i < to; i = i + this.blockStepInInit) {
  //     const fromBlock = i;
  //     const toBlock = i + this.blockStepInInit > to ? to : i + this.blockStepInInit;
  //     const fn = (...args) => cToken.getPastEvents(...args);
  //     const events = await retry(fn, [key, {fromBlock, toBlock}]);
  //     totalEvents = totalEvents.concat(events);
  //   }
  //   return totalEvents;
  // }

  async periodicUpdateUsers(lastUpdatedBlock, currBlock) {
    let accountsToUpdate = [];
    console.log({currBlock});

    const events = {
      'Mint' : ['minter'],
      'Redeem' : ['redeemer'],
      'Borrow' : ['borrower'],
      'RepayBorrow' : ['borrower'],
      'LiquidateBorrow' : ['liquidator','borrower'],
      'Transfer' : ['from', 'to']
    };

    for(const market of this.markets) {
      const ctoken = new this.web3.eth.Contract(Addresses.cTokenAbi, market);
      for(const [eventName, eventArgs] of Object.entries(events)) {
        console.log(`periodicUpdateUsers: Fetching new events for market ${market}, event name: ${eventName}, args: ${eventArgs.join(', ')}`);
        const fetchedAccounts = await fetchAllEventsAndExtractStringArray(ctoken, 'CTOKEN', eventName, eventArgs, lastUpdatedBlock, currBlock, this.blockStepLimit);
        // merge with accountsToUpdate
        accountsToUpdate = Array.from(new Set(accountsToUpdate.concat(fetchedAccounts)));
      }
    }

    console.log(`periodicUpdateUsers: will update ${accountsToUpdate.length} users`);

    // updating users in slices
    const bulkSize = this.multicallSize;
    for (let i = 0; i < accountsToUpdate.length; i = i + bulkSize) {
      const to = i + bulkSize > accountsToUpdate.length ? accountsToUpdate.length : i + bulkSize;
      const slice = accountsToUpdate.slice(i, to);
      const fn = (...args) => this.updateUsers(...args);
      await retry(fn, [slice]);
    }
  }

  async collectAllUsers(currBlock) {
    console.log({currBlock});
    let startBlock = this.deployBlock;
    this.userList = [];

    // load userlist from csv file
    const loadedUserListItem = loadUserListFromDisk(this.userListFileName);
    if(loadedUserListItem) {
      startBlock = loadedUserListItem.firstBlockToFetch;
      this.userList = loadedUserListItem.userList;
    }

    const newUserList =  await fetchAllEventsAndExtractStringArray(this.comptroller, 'Comptroller', 'MarketEntered', ['account'], startBlock, currBlock, this.blockStepLimit);
    console.log(`Found ${newUserList.length} users since block ${startBlock}`);
    this.userList = Array.from(new Set(this.userList.concat(newUserList)));

    console.log(`userlist contains ${this.userList.length} users`);
    saveUserListToDisk(this.userListFileName, this.userList, currBlock);
  }

  async updateAllUsers() {
    const users = this.userList; //require('./my.json')
    const bulkSize = this.multicallSize;
    for(let i = 0 ; i < users.length ; i+= bulkSize) {
      const start = i;
      const end = i + bulkSize > users.length ? users.length : i + bulkSize;
      console.log('update', i.toString() + ' / ' + users.length.toString());
      try {
        await this.updateUsers(users.slice(start, end));
      }
      catch(err) {
        console.log('update user failed, trying again', err);
        i -= bulkSize;
      }
    }
  }

  // eslint-disable-next-line no-unused-vars
  async additionalCollateralBalance(userAddress) {
    return this.web3.utils.toBN('0');
  }

  async calcBadDebt(currTime) {
    this.sumOfBadDebt = this.web3.utils.toBN('0');
    let deposits = this.web3.utils.toBN('0');
    let borrows = this.web3.utils.toBN('0');

    const userWithBadDebt = [];
        
    for(const [user, data] of Object.entries(this.users)) {

      const userData = new User(user, data.marketsIn, data.borrowBalance, data.collateralBalace, data.error);
      //console.log({user})
      const additionalCollateral = await this.additionalCollateralBalance(user);
      const userValue = userData.getUserNetValue(this.web3, this.prices);

      //console.log("XXX", user, userValue.collateral.toString(), additionalCollateral.toString())
      deposits = deposits.add(userValue.collateral).add(additionalCollateral);
      borrows = borrows.add(userValue.debt);

      const netValue = this.web3.utils.toBN(userValue.netValue).add(additionalCollateral);

      if(this.web3.utils.toBN(netValue).lt(this.web3.utils.toBN('0'))) {
        //const result = await this.comptroller.methods.getAccountLiquidity(user).call()
        console.log('bad debt for user', user, Number(netValue.toString())/1e6/*, {result}*/);
        this.sumOfBadDebt = this.sumOfBadDebt.add(this.web3.utils.toBN(netValue));

        console.log('total bad debt', Number(this.sumOfBadDebt.toString()) / 1e6);
                
        userWithBadDebt.push({'user' : user, 'badDebt' : netValue.toString()});
      }
    }

    this.output = { 'total' :  this.sumOfBadDebt.toString(), 'updated' : currTime.toString(), 'decimals' : '18', 'users' : userWithBadDebt,
      'tvl' : this.tvl.toString(), 'deposits' : deposits.toString(), 'borrows' : borrows.toString(),
      'calculatedBorrows' : this.totalBorrows.toString()};

    console.log(JSON.stringify(this.output));

    console.log('total bad debt', this.sumOfBadDebt.toString(), {currTime});

    return this.sumOfBadDebt;
  }

  async updateUsers(userAddresses) {
    // need to get: 1) user in market 2) user collateral in all markets 3) user borrow balance in all markets
        
    // market in
    const assetInCalls = [];
    console.log('preparing asset in calls');
    for(const user of userAddresses) {
      const call = {};
      call['target'] = this.comptroller.options.address;
      call['callData'] = this.comptroller.methods.getAssetsIn(user).encodeABI();
      assetInCalls.push(call);
    }
    const assetInResult = await this.multicall.methods.tryAggregate(false, assetInCalls).call();

    const ctoken = new this.web3.eth.Contract(Addresses.cTokenAbi);
        
    // collateral balance
    const collateralBalanceCalls = [];
    const borrowBalanceCalls = [];
    for(const user of userAddresses) {
      for(const market of this.markets) {
        const collatCall = {};
        const borrowCall = {};
    
        collatCall['target'] = market;
        borrowCall['target'] = market;
        if(this.rektMarkets.includes(market)) {
          // encode something that will return 0
          collatCall['callData'] = ctoken.methods.balanceOf(market).encodeABI();
        }
        else {
          collatCall['callData'] = ctoken.methods.balanceOfUnderlying(user).encodeABI();
        }
        if(this.nonBorrowableMarkets.includes(market)) {
          // encode something that will return 0
          borrowCall['callData'] = ctoken.methods.balanceOf(market).encodeABI();
        }
        else {
          borrowCall['callData'] = ctoken.methods.borrowBalanceCurrent(user).encodeABI();
        }

        collateralBalanceCalls.push(collatCall);
        borrowBalanceCalls.push(borrowCall);
      }
    }

    const collateralBalaceResultsPromise = this.multicall.methods.tryAggregate(false, collateralBalanceCalls).call();
    const borrowBalanceResultsPromise = this.multicall.methods.tryAggregate(false, borrowBalanceCalls).call();

    console.log('loading collateral and borrow balances');
    await Promise.all([collateralBalaceResultsPromise, borrowBalanceResultsPromise]);

    console.log('getting collateral balances');
    const collateralBalaceResults = await collateralBalaceResultsPromise;
    console.log('getting borrow balances');        
    const borrowBalanceResults = await borrowBalanceResultsPromise;

    // init class for all users
    let userIndex = 0;
    let globalIndex = 0;
    for(const user of userAddresses) {
      let success = true;
      if(! assetInResult[userIndex].success) success = false;
      const assetsIn = this.web3.eth.abi.decodeParameter('address[]', assetInResult[userIndex].returnData);
      userIndex++;

      const borrowBalances = {};
      const collateralBalances = {};
      for(const market of this.markets) {
        if(! collateralBalaceResults[globalIndex].success) success = false;
        if(! borrowBalanceResults[globalIndex].success) success = false;

        const colatBal = this.web3.eth.abi.decodeParameter('uint256', collateralBalaceResults[globalIndex].returnData);
        const borrowBal = this.web3.eth.abi.decodeParameter('uint256', borrowBalanceResults[globalIndex].returnData);
        borrowBalances[market] = borrowBal.toString();
        collateralBalances[market] = colatBal.toString();
        // borrowBalances[market] = this.web3.utils.toB(borrowBal);
        // collateralBalances[market] = this.web3.utils.toBN(colatBal);               

        globalIndex++;
      }

      const userData = new User(user, this.intersect(assetsIn, this.markets), borrowBalances, collateralBalances, ! success);
      const userNetValue = userData.getUserNetValue(this.web3, this.prices);

      if( this.web3.utils.toBN(userNetValue.collateral).eq(this.web3.utils.toBN('0')) &&
          this.web3.utils.toBN(userNetValue.debt).eq(this.web3.utils.toBN('0'))) {
        // console.log(`user ${user} has 0 collateral and debt, will not save it`);
        this.cptUserZeroValue++;

        // if an user had some collateral and debt but not anymore, deleting it
        if(this.users[user]) {
          delete this.users[user];
        }

      } else {
        this.users[user] = userData;
      }
    }
  }

  intersect(arr1, arr2) {
    const result = [];
    for(const a of arr1) {
      if(arr2.includes(a)) result.push(a);
    }

    return result;
  }
}

module.exports = Compound;

/*
const Web3 = require("web3")



async function test() {
    //const comp = new Compound(Addresses.traderJoeAddress, "AVAX", web3)
    //const comp = new Compound(Addresses.ironBankAddress, "AVAX", web3)
    const comp = new Compound(Addresses.ironBankAddress, "ETH", web3)
    //const comp = new Compound(Addresses.venusAddress, "BSC", web3)

        
    await comp.main()
    //await comp.updateUsers(["0x6C09184c823CC246435d1287F0AA3948742830E0","0x16b134c44170d78e2f8cad567bb70462dbf05a04"])
    //await comp.collectAllUsers()
    //await comp.updateUsers(["0xb3fbE25Be2e8CA097e9ac924e94aF000DD3A5663"])
    //await comp.updateAllUsers()
    //await comp.periodicUpdate(14788673 - 1000)
    //await comp.calcBadDebt()
 }

 test()*/

