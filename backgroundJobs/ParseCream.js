const axios = require('axios');
const Addresses = require("./Addresses.js")
const BSCParser = require("./BSCParser.js")
const Web3 = require("web3")
require('dotenv').config()


class CreamParser extends BSCParser {
    constructor() {
        const compoundInfo = Addresses.creamAddress
        const network = 'BSC'
        const web3 = new Web3(process.env.BSC_NODE_URL)
        super(compoundInfo, network, web3, 24, 1, 'cream_BSC_users.json')
    }
}

module.exports = { Parser: CreamParser}

// async function test() {
//   const parser = new CreamParser();
//   await parser.main();
// }

// test();