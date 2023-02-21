const Addresses = require("./Addresses.js")
const Web3 = require("web3")
const Compound = require("./CompoundParser.js")
require('dotenv').config()

class ParseApeswap extends Compound {
  constructor(webUrl = undefined) {
    const compoundInfo = Addresses.apeSwapAddress
    const network = 'BSC'
    const web3 = new Web3(webUrl ? webUrl : process.env.BSC_NODE_URL)
    super(compoundInfo, network, web3, 24, 1, 'apeswap_BSC_users.json', 'BSC Apeswap Runner', 'apeswap_BSC_data.csv')
  }
}

module.exports = { Parser: ParseApeswap }

// async function test() {
//   const parser = new ParseApeswap()
//   await parser.main()
// }

// test()