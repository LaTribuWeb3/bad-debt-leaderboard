const fs = require('fs');
const readline = require('readline');
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

function deleteUserDataFile(fileName) {
  const filePath = `saved_data/${fileName}`;
  if(fs.existsSync(filePath)) {
    fs.rmSync(`saved_data/${fileName}`);
  }
}

function appendToUserDataFile(fileName, userDataDictionary) {
  if(!fs.existsSync('saved_data')) {
    fs.mkdirSync('saved_data');
  }

  if(Object.keys(userDataDictionary).length == 0) {
    return;
  }

  const filePath = `saved_data/${fileName}`;
  console.log(`Adding ${Object.keys(userDataDictionary).length} user data to ${filePath}`);

  if(!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, 'userId;userData\n');
  }

  const toWrite = [];

  for(const [userId, userData] of Object.entries(userDataDictionary)) {
    const serializedData = JSON.stringify(userData);
    toWrite.push(`${userId};${serializedData}\n`)
  }

  fs.appendFileSync(filePath, toWrite.join(''));
}


async function updateUserDataFile(fileName, newUserData, newUsers) {
  if(!fs.existsSync('saved_data')) {
    fs.mkdirSync('saved_data');
  }

  if(Object.keys(newUserData).length == 0) {
    return;
  }

  const filePath = `saved_data/${fileName}`;
  const updatedFilePath = `saved_data/${fileName}-updt`;
  console.log(`Updating ${Object.keys(newUserData).length} new user data to ${filePath}`);

  if(!fs.existsSync(filePath)) {
    throw new Error('user data file should exists');
  }

  if(fs.existsSync(updatedFilePath)) {
    throw new Error('updated user data file should not exists');
  }
  
  fs.writeFileSync(updatedFilePath, 'userId;userData\n');

  const userDataReadlineAccessor = getUserDataReadlineInterface(fileName);

  let firstLine = true;
  let toWrite = [];

  const newUserKeys = Object.keys(newUserData);
  // read the data file line per line
  for await (const line of userDataReadlineAccessor.readlineInterface) {
      if(firstLine) {
          firstLine = false;
          continue;
      }

      const user = line.split(';')[0];

      // check if the user is in the user list to update
      if(newUserKeys.includes(user)) {
        // if so, save the new user data
        const serializedData = JSON.stringify(newUserData[user]);
        toWrite.push(`${user};${serializedData}\n`);
      } else {
        // else, just save old data (it will mostly be the case)
        toWrite.push(line +'\n');
      }

      // write every 1000 lines to reduce I/O
      if(toWrite.length >= 1000) {
        fs.appendFileSync(updatedFilePath, toWrite.join(''));
        toWrite = [];
      }
  }

  if(toWrite.length > 0) {
    fs.appendFileSync(updatedFilePath, toWrite.join(''));
    toWrite = [];
  }

  // add the new users 
  for(const newUser of newUsers) {
    const userData = newUserData[newUser];
    if(userData) {
      const serializedData = JSON.stringify(userData);
      toWrite.push(`${newUser};${serializedData}\n`);
    } else {
      console.log(`new user ${newUser} is not in newUserData, might be empty account`)
    }    
  }

  if(toWrite.length > 0) {
    fs.appendFileSync(updatedFilePath, toWrite.join(''));
  }

  // at the end, close the filestream
  userDataReadlineAccessor.stream.close();

  // delete old file
  fs.rmSync(filePath);
  // rename new file
  fs.renameSync(updatedFilePath, filePath);
}

function getUserDataReadlineInterface(fileName) {
  const filePath = `saved_data/${fileName}`;
  const fileStream = fs.createReadStream(filePath);

  const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
  });

  return { readlineInterface: rl, stream: fileStream };
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
  generateMonitoringJSON,
  appendToUserDataFile,
  deleteUserDataFile,
  getUserDataReadlineInterface,
  updateUserDataFile
}