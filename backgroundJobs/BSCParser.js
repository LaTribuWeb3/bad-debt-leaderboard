const axios = require('axios');
const Addresses = require("./Addresses.js")
const Compound = require("./CompoundParser")
const Web3 = require("web3")
require('dotenv').config()
const {retry, loadUserListFromDisk, saveUserListToDisk} = require("../utils")
let LOAD_USERS_FROM_DISK = process.env.LOAD_USER_FROM_DISK && process.env.LOAD_USER_FROM_DISK.toLowerCase() == 'true';

class BSCParser extends Compound {
    async collectAllUsers() {
        const currBlock = await this.web3.eth.getBlockNumber() - 10
        const comptrollerAddress = this.comptroller.options.address
        let firstBlockToFetch = this.deployBlock - 1;

        if(LOAD_USERS_FROM_DISK) {
            const loadedValue = loadUserListFromDisk(this.userFileName)
            if(loadedValue) {
                firstBlockToFetch = loadedValue.firstBlockToFetch;
                this.userList = loadedValue.userList;
            }
        }

        console.log(`collectAllUsers: Will fetch users from block ${firstBlockToFetch} to block ${currBlock}. Starting user count: ${this.userList.length}`);
        for(let startBlock = firstBlockToFetch ; startBlock < currBlock ; startBlock += this.blockStepInInit) {
            const endBlock = (startBlock + this.blockStepInInit > currBlock) ? currBlock : startBlock + this.blockStepInInit
            console.log(`collectAllUsers: ${startBlock} -> ${endBlock}. Stepsize: ${this.blockStepInInit}. Users: ${this.userList.length}`)

            let hasMorePages = true
            let pageNumber = 0;
            while(hasMorePages) {
                const url = "https://api.covalenthq.com/v1/56/events/topics/0x3ab23ab0d51cccc0c3085aec51f99228625aa1a922b3a8ca89a26b0f2027a1a5/?quote-currency=USD&format=JSON&"
                +
                "starting-block=" + startBlock.toString() + "&ending-block=" + endBlock.toString() +
                "&sender-address=" + comptrollerAddress + "&page-number="
                    + pageNumber.toString() + 
                    "&key=ckey_2d9319e5566c4c63b7b62ccf862"
                    
                const fn = (...args) => axios.get(...args)
                const result = await retry(fn, [url])                    
                //const result = await axios.get(url)
                const data = result.data.data
                for(const item of data.items) {
                    const user = this.web3.utils.toChecksumAddress("0x" + item.raw_log_data.slice(-40))
                    // TODO - adjust checksum
        
                    if(! this.userList.includes(user)) this.userList.push(user)
                    //console.log(user)            
                }
        
                //console.log(result.data)
                hasMorePages = data.pagination.has_more     
                pageNumber++;
            }
            // console.log(this.userList.length)            
        }
        

        if(LOAD_USERS_FROM_DISK) {
            saveUserListToDisk(this.userFileName, this.userList, currBlock)
        }
    }
}

module.exports = BSCParser
