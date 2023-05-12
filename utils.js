

const fs = require('fs');
const MAX_RETRIES = 10;

const sleep = async seconds => {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
};

let startDate = 0;
const formatMemoryUsage = (data) => `${Math.round(data / 1024 / 1024)} MB`;

function displayMemoryUsage() {

  const memoryData = process.memoryUsage();


  const filename = process.argv[1].split('\\').at(-1);

  if(startDate == 0) {
    startDate = Date.now();
    fs.writeFileSync(`${filename}-memoryusage.log`, 'runtime (sec), Resident Set Size - total memory allocated for the process execution,total size of the allocated heap,actual memory used during the execution, V8 external memory\n');
  }
  
  // const memoryUsage = {
  //   rss: `${formatMemoryUsage(memoryData.rss)} -> Resident Set Size - total memory allocated for the process execution`,
  //   heapTotal: `${formatMemoryUsage(memoryData.heapTotal)} -> total size of the allocated heap`,
  //   heapUsed: `${formatMemoryUsage(memoryData.heapUsed)} -> actual memory used during the execution`,
  //   external: `${formatMemoryUsage(memoryData.external)} -> V8 external memory`,
  // };
  // console.log(memoryUsage);
  fs.appendFileSync(`${filename}-memoryusage.log`, `${Math.round((Date.now() - startDate)/1000)},${memoryData.rss},${memoryData.heapTotal},${memoryData.heapUsed},${memoryData.external}\n`);
}

const halfHour = 1000 * 60 * 30;

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
      console.log(`retry exit ${retries} retries` , fn.name);
      process.exit(0);
    }
    const res = await  fn(...params);
    if(retries){
      console.log(`retry success after ${retries} retries` , fn.name);
    } else {
      console.log('success on first try', fn.name);
    }
    return res;
  } catch (e) {
    console.error(e);
    retries++;
    console.log(`retry #${retries}`);
    const ms = (1000 * 5 * retries) > halfHour ? halfHour : (1000 * 5 * retries);
    await new Promise(resolve => setTimeout(resolve, ms));
    return retry(fn, params, retries);
  }
};

function loadUserListFromDisk(fileName) {
  if(!fs.existsSync('saved_data')) {
    fs.mkdirSync('saved_data');
  }

  if(fs.existsSync(`saved_data/${fileName}`)) {
    const savedData = JSON.parse(fs.readFileSync(`saved_data/${fileName}`));
    if(savedData.lastFetchedBlock && savedData.users) {
      const firstBlockToFetch = savedData.lastFetchedBlock +1;
      const userList = savedData.users;
      console.log(`loadUserListFromDisk: Loaded user list from disk, next block to fetch: ${firstBlockToFetch}. Current userList.length: ${userList.length}.`);
      return {
        firstBlockToFetch: firstBlockToFetch,
        userList: userList
      };
    }

  } else {
    console.log(`loadUserListFromDisk: Could not find saved data file saved_data/${fileName}`);
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

module.exports = { 
  sleep,
  retry,
  displayMemoryUsage,
  loadUserListFromDisk,
  saveUserListToDisk,
  formatMemoryUsage
};