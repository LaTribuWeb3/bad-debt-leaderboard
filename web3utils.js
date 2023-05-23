const Web3 = require('web3');
const { sleep } = require('./utils');
const { toBN, fromWei } = Web3.utils;

function normalize(amount, decimals) {
  if(decimals === 18) {
    return  Number(fromWei(amount));
  }
  else if(decimals > 18) {
    const factor = toBN('10').pow(toBN(decimals - 18));
    const norm = toBN(amount.toString()).div(factor);
    return Number(fromWei(norm));
  } else {
    const factor = toBN('10').pow(toBN(18 - decimals));
    const norm = toBN(amount.toString()).mul(factor);
    return Number(fromWei(norm));
  }
}

/**
 * Fetch all events in the blockrange [startBlock-targetBlock] using the web3 contract, the event name and the arg name(s) to extract a list of strings, deduplicated
 * @param {*} contract 
 * @param {string} contractName 
 * @param {string} eventName 
 * @param {string[]} argNames 
 * @param {number} startBlock 
 * @param {number} targetBlock 
 * @param {number} blockStepLimit some rpc have a strict limit, use this number as fixed blockstep when defined
 * @returns {Promise<string[]>}
 */
async function fetchAllEventsAndExtractStringArray(contract, contractName, eventName, argNames, startBlock, targetBlock, blockStepLimit = undefined) {
  const extractedArray = [];
  const logPrefix = `fetchAllEvents[${contractName}-${eventName}-${argNames.join(',')}]`;

  console.log(`${logPrefix}: will fetch events for ${targetBlock - startBlock + 1} blocks`);
  let blockStep = blockStepLimit || 10000;
  let fromBlock = startBlock;
  let toBlock = 0;
  let cptError = 0;
  while(toBlock < targetBlock) {
    toBlock = fromBlock + blockStep - 1;
    if(toBlock > targetBlock) {
      toBlock = targetBlock;
    }

    let events = undefined;
    try {
      events = await contract.getPastEvents(eventName, {fromBlock: fromBlock, toBlock:toBlock});
    }
    catch(e) {
      // console.log(`query filter error: ${e.toString()}`);
      blockStep = Math.round(blockStep / 2);
      if(blockStep < 1000) {
        blockStep = 1000;
      }
      toBlock = 0;
      cptError++;
      if(cptError >= 15) {
        console.log(`getPastEvents error: ${e.toString()}`);
        throw e;
      }
      await sleep(5000);
      continue;
    }


    if(events.length != 0) {
      for(const e of events) {
        for(const argName of argNames) {
          const a = e.returnValues[argName].toString();
          if(!extractedArray.includes(a)) {
            extractedArray.push(a);
          } 
        }
      }

      // try to find the blockstep to reach 8000 events per call as the RPC limit is 10 000, 
      // this try to change the blockstep by increasing it when the pool is not very used
      // or decreasing it when the pool is very used
      // in any case, should not set the new blockstep to more than 2 times the old one
      const newBlockStep = Math.min(1_000_000, Math.round(blockStep * 8000 / events.length));
      if(newBlockStep > blockStep * 2) {
        blockStep = blockStep * 2;
      } else {
        blockStep = newBlockStep;
      }
      cptError = 0;
    } else {
      // if 0 events, multiply blockstep by 2
      blockStep = blockStep * 2 ;
    }

    console.log(`${logPrefix}: [${fromBlock} - ${toBlock}] found ${events.length} events after ${cptError} errors (fetched ${toBlock-fromBlock+1} blocks). Current results: ${extractedArray.length}`);

    fromBlock = toBlock +1;

    if(blockStepLimit) {
      blockStep = blockStepLimit;
    }
  }

  console.log(`${logPrefix}: found ${extractedArray.length} ${argNames.join(',')} in range [${startBlock} ${targetBlock}]`);
  return extractedArray;
}

module.exports = {normalize, fetchAllEventsAndExtractStringArray};