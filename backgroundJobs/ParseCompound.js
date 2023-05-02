const Addresses = require("./Addresses.js")
const Compound = require("./CompoundParser")
const Web3 = require("web3")
require('dotenv').config()

class CompoundParser extends Compound {
  constructor() {
    const compoundInfo = Addresses.compoundAddress
    const network = 'ETH'
    const web3 = new Web3(process.env.ETH_NODE_URL)
    super(compoundInfo, network, web3, 24, 1, 'compound_ETH_users.json', 'ETH Compound Runner', 'compound_ETH_data.csv')
  }
}

module.exports = { Parser: CompoundParser }

async function test() {
  const parser = new CompoundParser();
  await parser.main();
}

test();