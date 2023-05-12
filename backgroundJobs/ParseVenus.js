const Addresses = require('./Addresses.js');
const BSCParser = require('./BSCParser');
const Compound = require('./CompoundParser');
const Web3 = require('web3');
require('dotenv').config();


class VenusParser extends Compound {
  constructor() {
    const compoundInfo = Addresses.venusAddress;
    const network = 'BSC';
    const web3 = new Web3(process.env.BSC_NODE_URL);
    super(compoundInfo, network, web3, 24 * 5);
  }
}

module.exports = { Parser: VenusParser };

// async function test() {
//   const comp = new VenusParser();
//   await comp.main();    
// }

// test();
