/*
# Copyright IBM Corp. All Rights Reserved.
#
# SPDX-License-Identifier: Apache-2.0
*/

// ====CHAINCODE EXECUTION SAMPLES (CLI) ==================

// ==== Invoke marbles ====
// peer chaincode invoke -C myc1 -n marbles -c '{"Args":["initMarble","marble1","blue","35","tom"]}'
// peer chaincode invoke -C myc1 -n marbles -c '{"Args":["initMarble","marble2","red","50","tom"]}'
// peer chaincode invoke -C myc1 -n marbles -c '{"Args":["initMarble","marble3","blue","70","tom"]}'
// peer chaincode invoke -C myc1 -n marbles -c '{"Args":["transferMarble","marble2","jerry"]}'
// peer chaincode invoke -C myc1 -n marbles -c '{"Args":["transferMarblesBasedOnColor","blue","jerry"]}'
// peer chaincode invoke -C myc1 -n marbles -c '{"Args":["delete","marble1"]}'

// ==== Query marbles ====
// peer chaincode query -C myc1 -n marbles -c '{"Args":["readMarble","marble1"]}'
// peer chaincode query -C myc1 -n marbles -c '{"Args":["getMarblesByRange","marble1","marble3"]}'
// peer chaincode query -C myc1 -n marbles -c '{"Args":["getHistoryForMarble","marble1"]}'
// peer chaincode query -C myc1 -n marbles -c '{"Args":["getMarblesByRangeWithPagination","marble1","marble3","3",""]}'

// Rich Query (Only supported if CouchDB is used as state database):
// peer chaincode query -C myc1 -n marbles -c '{"Args":["queryMarblesByOwner","tom"]}'
// peer chaincode query -C myc1 -n marbles -c '{"Args":["queryMarbles","{\"selector\":{\"owner\":\"tom\"}}"]}'

// Rich Query with Pagination (Only supported if CouchDB is used as state database):
// peer chaincode query -C myc1 -n marbles -c '{"Args":["queryMarblesWithPagination","{\"selector\":{\"owner\":\"tom\"}}","3",""]}'

'use strict';
const shim = require('fabric-shim');
const util = require('util');

const Chaincode = class {
  async Init(stub) {
    const ret = stub.getFunctionAndParameters();
    console.info(ret);
    console.info('=========== Instantiated Marbles Chaincode ===========');
    return shim.success();
  }

  async Invoke(stub) {
    console.info('Transaction ID: ' + stub.getTxID());
    console.info(util.format('Args: %j', stub.getArgs()));

    const ret = stub.getFunctionAndParameters();
    console.info(ret);

    const method = this[ret.fcn];
    if (!method) {
      console.log(`no function of name:${ret.fcn} found`);
      throw new Error(`Received unknown function ${ret.fcn} invocation`);
    }
    try {
      const payload = await method(stub, ret.params, this);
      return shim.success(payload);
    } catch (err) {
      console.log(err);
      return shim.error(err);
    }
  }

  // ===============================================
  // initMarble - create a new marble
  // ===============================================
  async initMarble(stub, args) {
    if (args.length !== 4) {
      throw new Error('Incorrect number of arguments. Expecting 4');
    }
    // ==== Input sanitation ====
    console.info('--- start init marble ---')
    if (!args[0].length) {
      throw new Error('1st argument must be a non-empty string');
    }
    if (!args[1].length) {
      throw new Error('2nd argument must be a non-empty string');
    }
    if (!args[2].length) {
      throw new Error('3rd argument must be a non-empty string');
    }
    if (!args[3].length) {
      throw new Error('4th argument must be a non-empty string');
    }
    const marbleName = args[0];
    const color = args[1].toLowerCase();
    const owner = args[3].toLowerCase();
    const size = parseInt(args[2]);
    if (typeof size !== 'number') {
      throw new Error('3rd argument must be a numeric string');
    }

    // ==== Check if marble already exists ====
    const marbleState = await stub.getState(marbleName);
    if (marbleState.toString()) {
      throw new Error('This marble already exists: ' + marbleName);
    }

    // ==== Create marble object and marshal to JSON ====
    const marble = {
      docType: 'marble',
      name: marbleName,
      color: color,
      size: size,
      owner: owner
    };

    // === Save marble to state ===
    await stub.putState(marbleName, Buffer.from(JSON.stringify(marble)));
    const indexName = 'color~name'
    const colorNameIndexKey = await stub.createCompositeKey(indexName, [marble.color, marble.name]);
    console.info(colorNameIndexKey);
    //  Save index entry to state. Only the key name is needed, no need to store a duplicate copy of the marble.
    //  Note - passing a 'nil' value will effectively delete the key from state, therefore we pass null character as value
    await stub.putState(colorNameIndexKey, Buffer.from('\u0000'));
    // ==== Marble saved and indexed. Return success ====
    console.info('- end init marble');
  }

  // ===============================================
  // readMarble - read a marble from chaincode state
  // ===============================================
  async readMarble(stub, args) {
    if (args.length !== 1) {
      throw new Error('Incorrect number of arguments. Expecting name of the marble to query');
    }

    const name = args[0];
    if (!name) {
      throw new Error(' marble name must not be empty');
    }
    const marbleAsbytes = await stub.getState(name); //get the marble from chaincode state
    if (!marbleAsbytes.toString()) {
      const jsonResp = {
        error: `Marble does not exist: ${name}`
      };
      throw new Error(JSON.stringify(jsonResp));
    }
    console.info('=======================================');
    console.log(marbleAsbytes.toString());
    console.info('=======================================');
    return marbleAsbytes;
  }

  // ==================================================
  // delete - remove a marble key/value pair from state
  // ==================================================
  async delete(stub, args) {
    if (args.length !== 1) {
      throw new Error('Incorrect number of arguments. Expecting name of the marble to delete');
    }
    const marbleName = args[0];
    if (!marbleName) {
      throw new Error('marble name must not be empty');
    }
    // to maintain the color~name index, we need to read the marble first and get its color
    const valAsbytes = await stub.getState(marbleName); //get the marble from chaincode state
    const jsonResp = {};
    if (!valAsbytes) {
      jsonResp.error = `marble does not exist: ${marbleName}`;
      throw new Error(jsonResp);
    }
    let marbleJSON = {};
    try {
      marbleJSON = JSON.parse(valAsbytes.toString());
    } catch (err) {
      jsonResp.error = `Failed to decode JSON of: ${marbleName}`;
      throw new Error(jsonResp);
    }
    await stub.deleteState(marbleName); //remove the marble from chaincode state

    // delete the index
    const indexName = 'color~name';
    const colorNameIndexKey = stub.createCompositeKey(indexName, [marbleJSON.color, marbleJSON.name]);
    if (!colorNameIndexKey) {
      throw new Error(' Failed to create the createCompositeKey');
    }
    //  Delete index entry to state.
    await stub.deleteState(colorNameIndexKey);
  }

  // ===========================================================
  // transfer a marble by setting a new owner name on the marble
  // ===========================================================
  async transferMarble(stub, args) {
    //   0       1
    // 'name', 'bob'
    if (args.length < 2) {
      throw new Error('Incorrect number of arguments. Expecting marblename and owner')
    }

    const marbleName = args[0];
    const newOwner = args[1].toLowerCase();
    console.info('- start transferMarble ', marbleName, newOwner);

    const marbleAsBytes = await stub.getState(marbleName);
    if (!marbleAsBytes || !marbleAsBytes.toString()) {
      throw new Error('marble does not exist');
    }
    let marbleToTransfer = {};
    try {
      marbleToTransfer = JSON.parse(marbleAsBytes.toString()); //unmarshal
    } catch (err) {
      const jsonResp = {
        error: `Failed to decode JSON of: ${marbleName}`
      };
      throw new Error(jsonResp);
    }
    console.info(marbleToTransfer);
    marbleToTransfer.owner = newOwner; //change the owner

    const marbleJSONasBytes = Buffer.from(JSON.stringify(marbleToTransfer));
    await stub.putState(marbleName, marbleJSONasBytes); //rewrite the marble

    console.info('- end transferMarble (success)');
  }

  // ===========================================================================================
  // getMarblesByRange performs a range query based on the start and end keys provided.

  // Read-only function results are not typically submitted to ordering. If the read-only
  // results are submitted to ordering, or if the query is used in an update transaction
  // and submitted to ordering, then the committing peers will re-execute to guarantee that
  // result sets are stable between endorsement time and commit time. The transaction is
  // invalidated by the committing peers if the result set has changed between endorsement
  // time and commit time.
  // Therefore, range queries are a safe option for performing update transactions based on query results.
  // ===========================================================================================
  async getMarblesByRange(stub, args, thisClass) {

    if (args.length < 2) {
      throw new Error('Incorrect number of arguments. Expecting 2');
    }

    const startKey = args[0];
    const endKey = args[1];

    const resultsIterator = await stub.getStateByRange(startKey, endKey);
    const method = thisClass['getAllResults'];
    const results = await method(resultsIterator, false);

    return Buffer.from(JSON.stringify(results));
  }

  // ==== Example: GetStateByPartialCompositeKey/RangeQuery =========================================
  // transferMarblesBasedOnColor will transfer marbles of a given color to a certain new owner.
  // Uses a GetStateByPartialCompositeKey (range query) against color~name 'index'.
  // Committing peers will re-execute range queries to guarantee that result sets are stable
  // between endorsement time and commit time. The transaction is invalidated by the
  // committing peers if the result set has changed between endorsement time and commit time.
  // Therefore, range queries are a safe option for performing update transactions based on query results.
  // ===========================================================================================
  async transferMarblesBasedOnColor(stub, args, thisClass) {

    //   0       1
    // 'color', 'bob'
    if (args.length < 2) {
      throw new Error('Incorrect number of arguments. Expecting color and owner');
    }

    const color = args[0];
    const newOwner = args[1].toLowerCase();
    console.info('- start transferMarblesBasedOnColor ', color, newOwner);

    // Query the color~name index by color
    // This will execute a key range query on all keys starting with 'color'
    const coloredMarbleResultsIterator = await stub.getStateByPartialCompositeKey('color~name', [color]);

    const method = thisClass['transferMarble'];
    // Iterate through result set and for each marble found, transfer to newOwner
    while (true) {
      const responseRange = await coloredMarbleResultsIterator.next();
      if (!responseRange?.value?.key) {
        return;
      }
      console.log(responseRange.value.key);

      // let value = res.value.value.toString('utf8');
      let objectType;
      let attributes;
      ({
        objectType,
        attributes
      } = await stub.splitCompositeKey(responseRange.value.key));

      const returnedColor = attributes[0];
      const returnedMarbleName = attributes[1];
      console.info(util.format('- found a marble from index:%s color:%s name:%s\n', objectType, returnedColor, returnedMarbleName));

      // Now call the transfer function for the found marble.
      // Re-use the same function that is used to transfer individual marbles
      const response = await method(stub, [returnedMarbleName, newOwner]);
    }

  }


  // ===== Example: Parameterized rich query =================================================
  // queryMarblesByOwner queries for marbles based on a passed in owner.
  // This is an example of a parameterized query where the query logic is baked into the chaincode,
  // and accepting a single query parameter (owner).
  // Only available on state databases that support rich query (e.g. CouchDB)
  // =========================================================================================
  async queryMarblesByOwner(stub, args, thisClass) {
    //   0
    // 'bob'
    if (args.length < 1) {
      throw new Error('Incorrect number of arguments. Expecting owner name.')
    }

    const owner = args[0].toLowerCase();
    const queryString = {
      selector: {
        docType: 'marble',
        owner: owner
      }

    };
    const method = thisClass['getQueryResultForQueryString'];
    const queryResults = await method(stub, JSON.stringify(queryString), thisClass);
    return queryResults; //shim.success(queryResults);
  }

  // ===== Example: Ad hoc rich query ========================================================
  // queryMarbles uses a query string to perform a query for marbles.
  // Query string matching state database syntax is passed in and executed as is.
  // Supports ad hoc queries that can be defined at runtime by the client.
  // If this is not desired, follow the queryMarblesForOwner example for parameterized queries.
  // Only available on state databases that support rich query (e.g. CouchDB)
  // =========================================================================================
  async queryMarbles(stub, args, thisClass) {
    //   0
    // 'queryString'
    if (args.length < 1) {
      throw new Error('Incorrect number of arguments. Expecting queryString');
    }
    const queryString = args[0];
    if (!queryString) {
      throw new Error('queryString must not be empty');
    }
    const method = thisClass['getQueryResultForQueryString'];
    const queryResults = await method(stub, queryString, thisClass);
    return queryResults;
  }

  async getAllResults(iterator, isHistory) {
    const allResults = [];
    while (true) {
      const res = await iterator.next();

      if (res.value?.value?.toString()) {
        const jsonRes = {};
        console.log(res.value.value.toString('utf8'));

        if (isHistory === true) {
          jsonRes.TxId = res.value.tx_id;
          jsonRes.Timestamp = res.value.timestamp;
          jsonRes.IsDelete = res.value.is_delete.toString();
          try {
            jsonRes.Value = JSON.parse(res.value.value.toString('utf8'));
          } catch (err) {
            console.log(err);
            jsonRes.Value = res.value.value.toString('utf8');
          }
        } else {
          jsonRes.Key = res.value.key;
          try {
            jsonRes.Record = JSON.parse(res.value.value.toString('utf8'));
          } catch (err) {
            console.log(err);
            jsonRes.Record = res.value.value.toString('utf8');
          }
        }
        allResults.push(jsonRes);
      }
      if (res.done) {
        console.log('end of data');
        await iterator.close();
        console.info(allResults);
        return allResults;
      }
    }
  }

  // =========================================================================================
  // getQueryResultForQueryString executes the passed in query string.
  // Result set is built and returned as a byte array containing the JSON results.
  // =========================================================================================
  async getQueryResultForQueryString(stub, queryString, thisClass) {

    console.info('- getQueryResultForQueryString queryString:\n' + queryString)
    const resultsIterator = await stub.getQueryResult(queryString);
    const method = thisClass['getAllResults'];
    const results = await method(resultsIterator, false);

    return Buffer.from(JSON.stringify(results));
  }

  async getHistoryForMarble(stub, args, thisClass) {

    if (!args.length) {
      throw new Error('Incorrect number of arguments. Expecting 1')
    }
    const marbleName = args[0];
    console.info('- start getHistoryForMarble: %s\n', marbleName);

    const resultsIterator = await stub.getHistoryForKey(marbleName);
    const method = thisClass['getAllResults'];
    const results = await method(resultsIterator, true);

    return Buffer.from(JSON.stringify(results));
  }

  // ====== Pagination =========================================================================
  // Pagination provides a method to retrieve records with a defined pagesize and
  // start point (bookmark).  An empty string bookmark defines the first "page" of a query
  // result. Paginated queries return a bookmark that can be used in
  // the next query to retrieve the next page of results. Paginated queries extend
  // rich queries and range queries to include a pagesize and bookmark.
  //
  // Two examples are provided in this example. The first is getMarblesByRangeWithPagination
  // which executes a paginated range query.
  // The second example is a paginated query for rich ad-hoc queries.
  // =========================================================================================

  // ====== Example: Pagination with Range Query ===============================================
  // getMarblesByRangeWithPagination performs a range query based on the start & end key,
  // page size and a bookmark.
  //
  // The number of fetched records will be equal to or lesser than the page size.
  // Paginated range queries are only valid for read only transactions.
  // ===========================================================================================
  async getMarblesByRangeWithPagination(stub, args, thisClass) {
    if (args.length < 2) {
      throw new Error('Incorrect number of arguments. Expecting 2');
    }
    const startKey = args[0];
    const endKey = args[1];

    const pageSize = parseInt(args[2], 10);
    const bookmark = args[3];

    const { iterator, metadata } = await stub.getStateByRangeWithPagination(startKey, endKey, pageSize, bookmark);
    const getAllResults = thisClass['getAllResults'];

    const results = {};

    results.results = await getAllResults(iterator, false);

    // use RecordsCount and Bookmark to keep consistency with the go sample
    results.ResponseMetadata = {
      RecordsCount: metadata.fetchedRecordsCount,
      Bookmark: metadata.bookmark,
    };

    return Buffer.from(JSON.stringify(results));
  }

  // =========================================================================================
  // getQueryResultForQueryStringWithPagination executes the passed in query string with
  // pagination info. Result set is built and returned as a byte array containing the JSON results.
  // =========================================================================================
  async queryMarblesWithPagination(stub, args, thisClass) {

    //   0
    // "queryString"
    if (args.length < 3) {
      return shim.Error("Incorrect number of arguments. Expecting 3")
    }

    const queryString = args[0];
    const pageSize = parseInt(args[1], 10);
    const bookmark = args[2];

    const { iterator, metadata } = await stub.getQueryResultWithPagination(queryString, pageSize, bookmark);
    const getAllResults = thisClass['getAllResults'];
    const results = {};

    results.results = await getAllResults(iterator, false);

    // use RecordsCount and Bookmark to keep consistency with the go sample
    results.ResponseMetadata = {
      RecordsCount: metadata.fetchedRecordsCount,
      Bookmark: metadata.bookmark,
    };

    return Buffer.from(JSON.stringify(results));
  }
};

shim.start(new Chaincode());