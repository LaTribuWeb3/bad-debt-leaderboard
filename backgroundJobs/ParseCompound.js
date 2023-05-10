const { displayMemoryUsage } = require('../utils.js');
const Addresses = require('./Addresses.js');
const Compound = require('./CompoundParser');
const Web3 = require('web3');
require('dotenv').config();

class CompoundParser extends Compound {
  constructor() {
    const compoundInfo = Addresses.compoundAddress;
    const network = 'ETH';
    const web3 = new Web3(process.env.ETH_NODE_URL);
    super(compoundInfo, network, web3, 24 * 5);
  }
}

async function test() {
  setInterval(() => displayMemoryUsage(), 10000);
  const parser = new CompoundParser();
  await parser.main();
}

test();

module.exports = { Parser: CompoundParser };