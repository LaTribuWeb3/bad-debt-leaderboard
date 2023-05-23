const Addresses = require("./Addresses.js")
const Compound = require("./CompoundParser")
const Web3 = require("web3")
require('dotenv').config()

class RariParser extends Compound {
  constructor() {
    const compoundInfo = Addresses.rariTetranodeAddress
    const network = 'ETH'
    const web3 = new Web3(process.env.ETH_NODE_URL)
    super(compoundInfo, network, web3, 24 * 5)
  }
}

// async function test() {
//   const parser = new RariParser();
//   await parser.main();
// }

// test();

module.exports = { Parser: RariParser }