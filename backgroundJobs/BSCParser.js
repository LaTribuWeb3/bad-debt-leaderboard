const axios = require('axios');
const Compound = require('./CompoundParser');
require('dotenv').config();
const {retry, loadUserListFromDisk, saveUserListToDisk} = require('../utils');

class BSCParser extends Compound {
  constructor(compoundInfo, network, web3, heavyUpdateInterval = 24, fetchDelayInHours = 1) {
    super(compoundInfo, network, web3, heavyUpdateInterval, fetchDelayInHours);
    this.covalentApiKey = process.env.COVALENT_API_KEY;
    if(!this.covalentApiKey) {
      throw new Error('Cannot work with BSCParser without covalent api key');
    } else {
      console.log(`Covalent api key is set with value: ${this.covalentApiKey.slice(0,6)}[...]${this.covalentApiKey.slice(-4)}`);
    }
  }

  async collectAllUsers(currBlock) {
    const comptrollerAddress = this.comptroller.options.address;
    console.log({currBlock});

    let startBlock = this.deployBlock;
    // load userlist from csv file
    const loadedUserListItem = loadUserListFromDisk(this.userListFileName);
    if(loadedUserListItem) {
      startBlock = loadedUserListItem.firstBlockToFetch;
      this.userList = loadedUserListItem.userList;
    }
        
    for(startBlock ; startBlock < currBlock ; startBlock += this.blockStepInInit) {
      const endBlock = (startBlock + this.blockStepInInit > currBlock) ? currBlock : startBlock + this.blockStepInInit;
      console.log(`collectAllUsers: collecting user from covalent api [${startBlock} - ${endBlock}]. Userlist: ${this.userList.length}`);

      let hasMore = true;
      for(let pageNumber = 0 ; hasMore ; pageNumber++) {
        const url = 'https://api.covalenthq.com/v1/56/events/topics/0x3ab23ab0d51cccc0c3085aec51f99228625aa1a922b3a8ca89a26b0f2027a1a5/?quote-currency=USD&format=JSON&'
                +
                'starting-block=' + startBlock.toString() + '&ending-block=' + endBlock.toString() +
                '&sender-address=' + comptrollerAddress + '&page-number='
                    + pageNumber.toString() + 
                    `&key=${this.covalentApiKey}`;
                    
        const result = await retry(axios.get, [url]);                    
        //const result = await axios.get(url)
        const data = result.data.data;
        for(const item of data.items) {
          const user = this.web3.utils.toChecksumAddress('0x' + item.raw_log_data.slice(-40));
          // TODO - adjust checksum
        
          if(! this.userList.includes(user)) this.userList.push(user);
          //console.log(user)            
        }
        
        //console.log(result.data)
        hasMore = data.pagination.has_more;        
      }
    }

    console.log(`userlist now contains ${this.userList.length} users`);
    saveUserListToDisk(this.userListFileName, this.userList, currBlock);
  }
}

module.exports = BSCParser;
