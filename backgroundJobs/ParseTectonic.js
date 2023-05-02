const Addresses = require("./Addresses.js")
const Compound = require("./CompoundParser.js")
const Web3 = require("web3")
require('dotenv').config()

class TectonicParser extends Compound {
  constructor() {
    const tectonicInfo = Addresses.tectonicAddress
    const network = 'CRO'
    const web3 = new Web3(process.env.CRO_NODE_URL)
    super(tectonicInfo, network, web3, 24, 1, 'tectonic_CRONOS_users.json', 'CRONOS Tectonic Runner', 'tectonic_CRONOS_data.csv')
  }
}

module.exports = { Parser: TectonicParser }


async function test() {
  const x = new TectonicParser()
  await x.main()
}

//test()
