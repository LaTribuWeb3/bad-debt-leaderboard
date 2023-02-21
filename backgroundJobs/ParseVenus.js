const axios = require('axios');
const Addresses = require("./Addresses.js")
const Web3 = require("web3");
const Compound = require('./CompoundParser.js');
require('dotenv').config()


class VenusParser extends Compound {
    constructor() {
        const compoundInfo = Addresses.venusAddress
        const network = 'BSC'
        const web3 = new Web3(process.env.BSC_NODE_URL)
        super(compoundInfo, network, web3, 24, 1, 'venus_BSC_users.json', 'BSC Venus Runner', 'venus_BSC_data.csv')
    }
}

module.exports = { Parser: VenusParser }

// async function test() {
//     const parser = new VenusParser()
//     await parser.main()    
// }

// test()
