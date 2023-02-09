const Addresses = require("./Addresses.js")
const AaveV3 = require("./AaveV3Parser")
const Web3 = require("web3")
require('dotenv').config()

class ParseAaveV3_Ethereum extends AaveV3 {
  constructor() {
    const network = 'ETH'
    const web3 = new Web3(process.env.ETH_NODE_URL)
    super(Addresses.aaveV3Configuration, network, web3, 24, 1, 'aavev3_ETHEREUM_users.json', 'ETH AaveV3 Runner');
  }
}

module.exports = { Parser: ParseAaveV3_Ethereum }

// async function test() {
//     const aavev3 = new ParseAaveV3_Ethereum();
//     await aavev3.main();
// }

// test()