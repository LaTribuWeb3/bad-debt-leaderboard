const Addresses = require("./Addresses.js")
const Compound = require("./CompoundParser")
const Web3 = require("web3")
require('dotenv').config()

class AurigamiParser extends Compound {
  constructor() {
    const compoundInfo = Addresses.aurigamiAddress
    const network = 'NEAR'
    const web3 = new Web3(process.env.NEAR_NODE_URL)
    super(compoundInfo, network, web3, 24, 1, 'aurigami_NEAR_users.json')
  }
}

module.exports = { Parser: AurigamiParser }

// async function test() {
//   const parser = new AurigamiParser();
//   await parser.main();
// }

// test();