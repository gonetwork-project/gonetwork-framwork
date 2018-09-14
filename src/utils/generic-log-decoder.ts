import * as abi from 'ethereumjs-abi'
import * as util from 'ethereumjs-util'

import { Abi } from 'eth-types'

export default class GenericLogDecoder {
  private eventMap: any

  constructor (abis: Abi[]) {
    this.eventMap = GenericLogDecoder.generateEventMap(abis)
  }

  static generateTopic (def: any) {
    return util.addHexPrefix(abi.eventID(def.name, def.inputs.map(y => y.type)).toString('hex'))
  }

  static generateEventMap (abis: Abi[]) {
    let definitions = (([] as Abi).concat(...abis))
      .filter((y) => y.type === 'event')
      .reduce((r, x) => {
        let topic = GenericLogDecoder.generateTopic(x)
        r[topic] = x
        return r
      }, {})
    return definitions
  }

	/**
	 * @param {Object} log - the ith log entry object returned from eth_getLogs() RPC call
	 * @returns {Object} - parsed event object
	 */
  decode (log) {
    // https://github.com/ethereum/wiki/wiki/JSON-RPC#eth_getfilterchanges

    if (this.eventMap.hasOwnProperty(log.topics[0])) {
      const eventDef = this.eventMap[log.topics[0]]
      const data = Buffer.concat(log.topics.slice(1).concat(log.data).map(y => util.toBuffer(y)))

      const result = abi.rawDecode(eventDef.inputs.map(x => x.type), data)
        .reduce((r, y, i) => {
          let t = eventDef.inputs[i]
          if (t.type === 'address') {
            y = util.toBuffer(util.addHexPrefix(y))
          }
          r[eventDef.inputs[i].name] = y
          return r
        }, {})
      result._type = eventDef.name
      result._contract = util.toBuffer(log.address)
      return result
    }

    console.log(log)
    // Throwing since we only want to decode known logs
    throw new Error('UNKNOWN_LOG')
  }
}
