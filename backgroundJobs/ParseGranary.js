const Addresses = require("./Addresses.js")
const Aave = require("./AaveParser")
const Web3 = require("web3")
const { toBN, toWei, fromWei } = Web3.utils
require('dotenv').config()

class ParseGranary extends Aave {
  constructor() {
    const network = 'FTM'
    const web3 = new Web3(process.env.FTM_NODE_URL) // https://rpc.fantom.network/
    super(Addresses.granaryAddress, network, web3, 24, 1, 'granary_FTM_users.json')
  }

  async initPrices() {
    await super.initPrices()

    // override eth price - as in granary the result is in 8 decimals USD
    this.ethPrice = toBN("10").pow(toBN("28"))
}  
}

module.exports = { Parser: ParseGranary }

// async function test() {
//   const g = new ParseGranary()
//   await g.main()
// }

// test()
