const Addresses = require("./Addresses.js")
const Compound = require("./CompoundParser")
const Web3 = require("web3")
require('dotenv').config()

class BenqiParser extends Compound {
  constructor() {
    const compoundInfo = Addresses.benqiAddress
    const network = 'AVAX'
    const web3 = new Web3(process.env.AVAX_NODE_URL)
    super(compoundInfo, network, web3, 24, 1, 'benqi_AVAX_users.json')
  }
}

module.exports = { Parser: BenqiParser }

// async function test() {
//   const parser = new BenqiParser();
//   await parser.main();
// }

// test();