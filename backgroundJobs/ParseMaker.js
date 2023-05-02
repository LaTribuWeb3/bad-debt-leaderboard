const Addresses = require("./Addresses.js")
const Maker = require("./MakerParser")
const Web3 = require("web3")
require('dotenv').config()

class ParseMaker extends Maker {
  constructor() {
    const web3 = new Web3(process.env.ETH_NODE_URL)
    super(web3)
  }
}

async function test() {
  const parser = new ParseMaker()
  parser.main();
}

test();

module.exports = { Parser: ParseMaker }
