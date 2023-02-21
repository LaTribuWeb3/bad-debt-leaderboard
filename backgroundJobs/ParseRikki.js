const Addresses = require("./Addresses.js")
const Web3 = require("web3")
const Compound = require("./CompoundParser.js")
require('dotenv').config()

class ParseRikki extends Compound {
  constructor(webUrl = undefined) {
    const compoundInfo = Addresses.rikkiAddress
    const network = 'BSC'
    const web3 = new Web3(webUrl ? webUrl : process.env.BSC_NODE_URL)
    super(compoundInfo, network, web3, 24, 1, 'rikkei_BSC_users.json', 'BSC Rikkei Runner', 'rikkei_BSC_data.csv')
  }
}

// async function test() {
//   const comp = new ParseRikki("https://bsc-dataseed1.defibit.io/")
//   await comp.main()
// }

//test()

module.exports = { Parser: ParseRikki }