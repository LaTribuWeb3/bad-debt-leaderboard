const fs = require('fs');
const MAX_RETRIES = 10

const sleep = async seconds => {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}

const halfHour = 1000 * 60 * 30

/**
 * a small retry wrapper with an incrameting 5s sleep delay
 * @param {*} fn 
 * @param {*} params 
 * @param {*} retries 
 * @returns 
 */
 const retry = async (fn, params, retries = 0) => {
  try {
      if (retries > MAX_RETRIES) {
        console.log(`retry exit ${retries} retries` , fn.name)
        process.exit(0)
      }
      const res = await  fn(...params)
      if(retries){
          // console.log(`retry success after ${retries} retries` , fn.name)
      } else {
          // console.log(`success on first try`, fn.name)
      }
      return res
  } catch (e) {
      console.error(e)
      retries++
      console.log(`retry #${retries}`)
      const ms = (1000 * 5 * retries) > halfHour ? halfHour : (1000 * 5 * retries)
      await sleep(ms / 1000);
      return retry(fn, params, retries)
  }
}



function loadUserListFromDisk(fileName) {
  if(!fs.existsSync('saved_data')) {
      fs.mkdirSync('saved_data');
  }

  if(fs.existsSync(`saved_data/${fileName}`)) {
      const savedData = JSON.parse(fs.readFileSync(`saved_data/${fileName}`));
      if(savedData.lastFetchedBlock && savedData.users) {
          const firstBlockToFetch = savedData.lastFetchedBlock +1;
          const userList = savedData.users;
          console.log(`loadUserListFromDisk: Loaded user list from disk, next block to fetch: ${firstBlockToFetch}. Current userList.length: ${userList.length}.`)
          return {
            firstBlockToFetch: firstBlockToFetch,
            userList: userList
          };
      }

  } else {
      console.log(`loadUserListFromDisk: Could not find saved data file saved_data/${fileName}, will fetch data from the begining`)
  }
  
  return undefined;

}

function saveUserListToDisk(fileName, userList, lastFetchedBlock) {
  if(!fs.existsSync('saved_data')) {
    fs.mkdirSync('saved_data');
  }

  const savedUserData = {
    lastFetchedBlock: lastFetchedBlock,
    users: userList
  };

  console.log(`saveUserListToDisk: Saving ${userList.length} users to file ${fileName}`);
  fs.writeFileSync(`saved_data/${fileName}`, JSON.stringify(savedUserData));
}

/**
 * 
 * @param {string} runnerName 
 * @param {string} status 
 * @param {number} lastStart 
 * @param {number} lastEnd 
 * @param {number} lastDuration 
 * @param {number} lastBlockFetched 
 * @param {any} error 
 * @returns {string} json representation of the monitoring object
 */
function generateMonitoringJSON(runnerName, status, lastStart, lastEnd, lastDuration, lastBlockFetched, error) {
  return JSON.stringify({
    "name": runnerName,
    "status": status,
    "lastStart": lastStart,
    "lastEnd": lastEnd,
    "lastDuration": lastDuration,
    "lastBlockFetched": lastBlockFetched,
    "error": error,
    "lastUpdate": Math.round(Date.now()/1000) // unix timestamp seconds
  });
}

module.exports = { 
  sleep,
  retry,
  loadUserListFromDisk,
  saveUserListToDisk,
  generateMonitoringJSON
}