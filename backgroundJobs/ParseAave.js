const Addresses = require("./Addresses.js")
const Aave = require("./AaveParser")
const Web3 = require("web3")
require('dotenv').config()

class ParseAave extends Aave {
  constructor() {
    const network = 'ETH'
    const web3 = new Web3(process.env.ETH_NODE_URL)
    super(Addresses.aaveAddress, network, web3, 24, 1, 'aave_ETH_users.json')
  }
}

module.exports = { Parser: ParseAave }

// async function test() {
//   const parser = new ParseAave();
//   await parser.main()
// }

// test();