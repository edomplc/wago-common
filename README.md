wago-common
======================

Communication with WAGO PLC 750- for nodejs

WORK IN PROGRESS

### Usage

Start from initializing the module providing to the init() at least:

  {
    "addressPLC": "192.168.1.3",
    "visuFile": "v_datatransfer"
  }
  
    
The plugin has the following configuration properties:

| Property          | Default  | Type    | Description                                 |
|:------------------|:---------|:--------|:--------------------------------------------|
| addressPLC        | -        | String  | IP address of your PLC without http or '/'  |
| visuFile          | -        | String  | Name of the visualization element used to transfer addresses|
| readInterval      | 1000     | Integer | Interval for reading data from the PLC |
| maxSendErrors     | 5        | Integer | How many attempts will be made before declaring a communication error|


### Methods

* getAddress = function(variable, callback)

Accepts variable name on input and returns the address found in the xml visualization file as the 2nd callback parameter: callback(null, addr)

* addToReadQueue = function(addr, callback)

Adds a read request to the queue, which collects all read requests into one statement and executes it at the intervals provided at init in the readInterval parameter.  This method might be needed if you cannot control how many read requests are triggered by elements of your system.  50 separate read request would thwart the communication.  If those are executed via addToReadQueue, the plugin consolidates them and executes the as one request.

Data received from the PLC is returned as the 2nd callback parameter: callback(null, reply)

* readData = function(addrs, callback)

Simply reads the value(s) held at the address provided in the addrs variable.  Addrs can be STRING (one address) or an ARRAY (many addresses).  The result is returned as the 2nd parameter of callback: callback(null, data), data being and ARRAY.

* writeData = function(addr, val, callback)

Sends data to PLC = writes value (val) to a given address (addr).  If successful, returns 'ok' in the 2nd parameter of callback: callback(null, 'ok')

* tap = function(addr, callback)

Taps a given address = writes 1 followed by 0 to address (addr).  If successful, returns 'ok' in the 2nd parameter of callback: callback(null, 'ok')