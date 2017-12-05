var Debug =0;

var AdmZip = require('adm-zip');
var xml2js = require('xml2js');
var request = require('request');

var events = require('events'); //testing
var fs = require('fs');
var http = require('http');

var status = new events.EventEmitter();  //testing

var config = {  //ok
  //default values
  readInterval: 1000,
  maxSendErrors: 5
};

var xmlObj = {}  //ok

var sendPending = false;
var sendQueue = [];
var sendErrors = 0;

var readRequest;
var readQueue = [];
var readTimer;

var initComplete = false;  //ok

var isInitComplete = function() {
  return initComplete 
}; exports.isInitComplete = isInitComplete;

var init = function(c, callback) {
    if (Debug >= 1) console.log('Initializing wago-common');
    
    var allowedAttrs = ['zipFile', 'wagoAddress', 'maxSendErrors', 'readInterval'];
    for (var attr in c) {
        if (allowedAttrs.indexOf(attr) >= 0) config[attr] = c[attr];
    }
    config.zipFileTo = '/tmp/' + config.zipFile + '_xml.zip';
    config.zipFileFrom = 'http://' + config.wagoAddress + '/plc/' + config.zipFile + '_xml.zip';
    
    download() //get the wago zip -> unpack -> parseXml
      .then(unpack)
      .then(parseXml)
      .then(() => {
        if (Debug == 2) console.log('init -> Completed!');
        initComplete = true;
        executeReadQueue();
        callback(null, true);
        
        //to handle trigger all requests, which were called from parent function before the init completed
        status.emit('initComplete');
        
      })
      .catch( (err) => {
        callback(err);
      });
    
    status.on('readQueueComplete', function() {
      readTimer = setTimeout(executeReadQueue,  Math.max(500, config.readInterval));
    });

};exports.init = init;

var download = function() {
  return new Promise((resolve, reject) => {
    if (Debug >= 1) console.log('download -> Downloading: ' + config.zipFileFrom + ' to: ' + config.zipFileTo);
       
    var file = fs.createWriteStream(config.zipFileTo);
    
    var request = http.get(config.zipFileFrom, function(response) {
        response.pipe(file);
        file.on('finish', function() {
            if (Debug == 2) console.log('download -> File ' + config.zipFileTo + ' retreived');
            file.close();
            resolve();
        });
    }).on('error', function(err) { // Handle errors
        fs.unlink(file); 
        reject(err);
    });
  })
};

var unpack = function() {
  return new Promise((resolve, reject) => {
    if (Debug == 2) console.log('unpack -> Unpacking ' + config.zipFileTo);
    
    var zip = new AdmZip(config.zipFileTo);
    zip.getEntries().forEach(function(zipEntry) {
      config.unzipFile = zipEntry.name;
    });

    // extracts everything
    zip.extractAllToAsync('/tmp/', /*overwrite*/true, function(err) {
        if (Debug == 2) console.log('unpack -> Unzip complete');
        if (typeof err == 'undefined') {
          resolve()
        }
        else {
           reject(err); 
        }
      });
  });
};

var parseXml = function() {
  return new Promise((resolve, reject) => {
    if (Debug == 2) console.log('parseXml -> Parsing ' + '/tmp/' + config.unzipFile);

    var parser = new xml2js.Parser();
    
    fs.readFile('/tmp/' + config.unzipFile, function(err, data) {
      if (err) {
        reject(err)
      }
      else {  
        parser.parseString(data, function (err, result) {
          if (err) 
            reject(err)
          else {
            xmlObj = result;
            if (Debug == 2) console.log('parseXml -> Parsing complete!');
            resolve()
          }
        });
      }
    });
  });
}

var getAddress = function(variable, callback) {
    if (Debug >= 1) console.log('getAddress -> Received address search request for ' + variable);
    if (initComplete) {
      
      //check if variable name carries a refference (for Struct data)
      var rRefference = variable.indexOf('<');

      if (rRefference >= 0) {
        //if so, extract the refference and convert to array
        var vLength = variable.length;
        var refference = variable.substring(rRefference + 1, vLength - 1)
        var refferenceA = refference.split(':');
        addrOffset = refferenceA[0];
        addrLength = refferenceA[1];
        addrType = refferenceA[2];
        
        //finally strip the variable from the refference
        variable = variable.substring(0, rRefference)
      }
      
      var findInXml = function(vName) {
        var xmlLink = xmlObj.visualisation.variablelist[0].variable
        var address = '|0|0|0|0|';
        xmlLink.some(function(addr) {
            if (addr.$.name == vName) {
                address = addr._;
                return true;
            }
        })
        return address;
      }
      //search the xml file 
      var addr = findInXml(variable).replace(/,/g, '|');
      
      //if the variable carried refference, modify the found address
      if (rRefference >= 0) {
        addrA = addr.split('|');
        addr = addrA[0] + '|' + (parseInt(addrA[1]) + parseInt(addrOffset)).toString() + '|' + addrLength + '|' + addrType
      }
      
      if (Debug == 2) console.log('getAddress -> found address ' + addr);
      callback(null, addr)
    }
    else {
      if (Debug == 2) console.log('getAddress -> Init not completed, adding request to queue');
      status.on('initComplete', function() {getAddress(variable, callback)});
    }

};exports.getAddress = getAddress;



var executeReadQueue = function() {
  if (Debug >= 1) console.log("executeReadQueue -> checking Read Queue. Items to serve: " + readQueue.length);
  
  if (readQueue.length > 0) {
    var start = new Date();

    //build the request: |0-for readying|number of addressses|address number from 0|address....
    var req = '|0|' + readQueue.length;
    readQueue.forEach(function(request, i) {
       req += '|' +  i + '|' + request.addr;
    });
    req += '|';    
    
    var url = 'http://' + config.wagoAddress + '/PLC/webvisu.htm';
    if (Debug == 2) console.log("executeReadQueue -> requesting " + req);
    
    readRequest = request({
          method: 'POST',
          url: url,
          body: req
      },
      function(error, response, body) {
        var finish = new Date();
        var duration = finish-start;
        
        if (Debug == 2) console.log("executeReadQueue -> completed in " + duration + "ms");
          //check reply validity
        if (!error && response.statusCode == 200) {
          var replies = body.slice(1, -1).split('|');
          if (Debug == 2) console.log("executeReadQueue -> success! Received valid reply: " + body);
          
          var i = replies.length;
          while (i--) {
            readQueue[i].callback(null, replies[i]);
            readQueue.splice(i, 1);
          }
        }
        else {
          if (Debug == 2) console.log("executeReadQueue -> error reading data, error: " + error);
          readQueue.forEach(function(request) {
              request.callback("Error", error);
            });
        }
        
        status.emit('readQueueComplete');
      }
    );
  }
  else {
    status.emit('readQueueComplete');
  }
}
var addToReadQueue = function(addr, callback) {
  
  if (Debug == 2) console.log("addToReadQueue -> adding to reqdQueue request for " + addr);
  
  if (!initComplete) {
    //For now we ignore all request done before the init is completed
    if (Debug == 2) console.log('addToReadQueue -> Init not completed, ignoring request');
    callback(null, 'wait');
    
    //Uncomment the below if you want to queue requests while waiting for init
    //if (Debug == 2) console.log('addToReadQueue -> Init not completed, adding request to queue');
    //status.on('initComplete', function() {addToReadQueue(addrs, callback)});
  } 
  else {
    if (typeof addr !== 'undefined' && addr.length > 0) {
      readQueue.push({addr: addr, callback: callback});
    }
    else {
        callback('Error', 'No address given');
    }
  }
  
};exports.addToReadQueue = addToReadQueue;


var readData = function(addrs, callback) {
  
  if (Debug == 2) console.log("readData -> received read request for " + addrs);
  
  if (!initComplete) {
    //For now we ignore all request done before the init is completed
    if (Debug == 2) console.log('readData -> Init not completed, ignoring request');
    callback(null, false);
    
    //Uncomment the below if you want to queue requests while waiting for init
    //if (Debug == 2) console.log('readData -> Init not completed, adding request to queue');
    //status.on('initComplete', function() {readData(addrs, callback)});
  }  
  else {
   
    if (typeof addrs !== 'undefined' && addrs.length > 0) {

      var start = new Date();
      
      //check if addrs is array, if not correct it
      if (addrs.constructor !== Array) addrs = [addrs];
      
      //build the request |0|number of addressses|address number from 0|address....
      var req = '|0|' + addrs.length;
      addrs.forEach(function(a, i) {
         req += '|' +  i + '|' + a;
      });
      req += '|';    
      
      var url = 'http://' + config.wagoAddress + '/PLC/webvisu.htm';
      if (Debug == 2) console.log("readData -> requesting " + req);
      
      readRequest = request({
              method: 'POST',
              url: url,
              body: req
          },
          function(error, response, body) {
            var finish = new Date();
            var duration = finish-start;
            
            if (Debug == 2) console.log("readData -> completed in " + duration + "ms");
              //check reply validity
            if (!error && response.statusCode == 200) {
              var data = body.slice(1, -1).split('|');
              if (Debug ==2) console.log("readData -> success! Received valid reply: " + data);
              callback(null, data);
            }
            else {
              if (Debug == 2) console.log("readData -> error reading data, error: " + error);
              callback("Error", error);  
            }
          }
      );
      
      
    }
    else {
        callback('Error', 'No addrs given');
    }
  
  }

};exports.readData = readData;

var writeData = function(addr, val, callback) {
  if (Debug == 2) console.log('writeData -> received send request');

  if (typeof(addr) !== 'undefined' && addr.length > 0) {
    if (sendPending) {
      if (Debug == 2) console.log('writeData -> busy with another request, adding to Queue');
      sendQueue.push({"address": addr, "value": val, "callback": callback})
    }			
    else {
      if (Debug == 2) console.log('writeData -> writing to: ' + addr + ' value: ' + val);
      sendPending = true;
      
      //if (typeof ReadAjax!=="undefined") ReadAjax.abort();
      //clearInterval(ReadTimeout);
      
      var req = '|1|1|0|' + addr + '|' + val + '|'; 
      var url = 'http://' + config.wagoAddress + '/PLC/webvisu.htm';
      if (Debug == 2) console.log('writeData -> writing ' + req + ' to: ' + url);

      request({
          method: 'POST',
          url: url,
          body: req
        },
        function(error, response, body) {
          //on complete
          if (Debug == 2) console.log("writeData -> completed! Queue length: " + sendQueue.length);
          
          sendPending = false;
          
          //check the response
          if (!error && response.statusCode == 200 && body =='|0|') { //all was fine!
            if (Debug == 2) console.log("writeData -> success! Received proper reply");
            sendErrors = 0;  //reset error count
            
            //take care for the queue
            if (sendQueue.length > 0) {
              var s = sendQueue[0];
              writeData(s.address, s.value, s.callback);  
              sendQueue.splice(0,1);
            }
            else {
              //HERE IS THE END
              callback(null, 'ok');
            }
          }
          else {  //there were errors
            if (Debug == 2) console.log("writeData -> there were errors! Error: " + error + ", body: " + body);
            sendErrors += 1;
            if (Debug == 2) console.log("writeData -> this was the " + sendErros + " attempt");
            
            //check if it is ok to retry!
            if (sendErrors < config.maxSendErrors) {
              writeData(s.address, s.value, s.callback); 
            }
            else {
              callback('error', 'writeData -> Maximum error number exceeded.  stopping'); 
            }
          } // Eof result handling
        } //Eof request callback funciton 
      ); //Eof request()
    } //Eof sending
  }  //Eof checking the request validity
  else {
    if (Debug >= 1) console.log("writeData -> Stopped.  Missing arguments");
    callback('Error', 'Missing parameters');
  }
};exports.writeData = writeData;

var tap = function(addr, callback) {
  if (Debug >= 1) console.log("tap -> Received tap request for address: " + addr);
  writeData(addr, 1, function(err, data) {
    if (data === 'ok') {
      writeData(addr, 0, callback)
    }
    else {
      callback('Error', data);
    }
  })
};exports.tap = tap;
