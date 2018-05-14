import { Observable } from 'rxjs/Observable'
import { Subject } from 'rxjs/Subject'
import { BehaviorSubject } from 'rxjs/BehaviorSubject'
import { EventEmitter } from 'events'

import { decode } from './log-decoder'

import * as T from '../types'

// todo: make it configurable
const KEY_PREFIX = '___ETH_MONITORING___'
const LOGS_INTERVAL = 5 * 1000
const TRANSACTION_INTERVAL = 5 * 1000

export type MonitorAddress = [T.EthAddress, T.EthBlockNumber | undefined]

export interface State {
  addresses: MonitorAddress[],
  transactions: T.EthAddress[]
}

export class Monitoring implements T.EthMonitoring {
  private _cfg: T.EthMonitoringConfig
  private _em = new EventEmitter()
  private _state: Promise<State>
  private _sub: any
  private _transactions: Subject<T.EthTransaction> = new Subject()
  private _blockNumberSub: BehaviorSubject<number | undefined>
    = new BehaviorSubject<number | undefined>(undefined)

  constructor (cfg: T.EthMonitoringConfig) {
    this._cfg = cfg
    this._state = cfg.storage.getItem(KEY_PREFIX + cfg.channelManagerAddress)
      .then(s => s ? JSON.parse(s) : {
        addresses: [
          [cfg.channelManagerAddress, -1],
          ...cfg.tokenAddresses.map(t => [t, -1])
        ]
      })

    this._sub =
      this._monitorAddresses()
        .merge(
          this._monitorBlockNumber(),
          this._monitorTransactions()
        )
        .subscribe()
  }

  subscribeChannel = (a) =>
    this._state.then(s => {
      console.log('SUB', a, s)
      if (s.addresses.find(_a => _a === a)) return Promise.resolve(false)
      s.addresses.push([a, undefined])
      return this._saveState(s)
    })

  unsubscribeChannel = (a) => {
    if (a === this._cfg.channelManagerAddress) return Promise.resolve(false)
    return this._state.then(s => {
      s.addresses = s.addresses.filter(_a => a !== _a[0])
      return this._saveState(s)
    })
  }

  transactionReceiptWithPersistance = (tx) => {
    return this._state.then(s => {
      if (s.transactions.find(tx)) {
        return false
      }
      s.transactions.push(tx)
      return this._saveState(s)
        .then(() => this._transactions.next(tx))
        .then(() => true)
    })
  }

  transactionReceipt = (tx) =>
    Observable.timer(0, TRANSACTION_INTERVAL)
      .switchMap(() =>
        Observable.defer(() => this._cfg.getTransactionReceipt(tx))
          .catch((err) => {
            console.log('TRANSACTION_MONITORING_ERROR', err)
            return Observable.empty()
          })
      )
      .take(1)
      .toPromise()

  on (event: T.BlockchainEventType, listener: (...args: any[]) => void) {
    this._em.on(event, listener)
  }

  off (event: T.BlockchainEventType, listener: (...args: any[]) => void) {
    this._em.removeListener(event, listener)
  }

  dispose = () => this._sub && this._sub.unsubscribe()

  private _blockNumber = () => this._blockNumberSub.value

  private _monitorBlockNumber = () =>
    Observable.timer(0, LOGS_INTERVAL)
      .switchMap(() =>
        Observable.defer(() => this._cfg.blockNumber())
          .retryWhen(errs => errs.delay(1000))
      )
      .map(x => parseInt(x, 16))
      .do(x => console.log('CURRENT_BLOCK', x))
      .do(x => x !== this._blockNumber() && this._blockNumberSub.next(x))

  private _monitorAddresses = () =>
    this._blockNumberSub
      .do(x => console.log('BN-SUBJECT', x))
      .filter(x => x !== undefined)
      .exhaustMap((blockNumber: T.EthBlockNumber) =>
        Observable.defer(() => this._state)
          .mergeMap((s: State) =>
            Observable.from(s.addresses)
              .groupBy(a => a[1])
              .mergeMap(xs => xs
                .map(x => x[0])
                .reduce((acc, x) => acc.concat([x]), [])
                .mergeMap(gs =>
                  Observable.defer(() => {
                    if (xs.key < blockNumber) {
                      console.log(xs.key, blockNumber, gs)
                      return this._cfg.getLogs(xs.key + 1, blockNumber, gs)
                    } else {
                      return Observable.of([] as T.BlockchainEvent[])
                    }
                  })
                    .map(logs => logs.map(decode))
                    .reduce((acc, logs) => ({
                      logs: acc.logs.concat(logs),
                      addresses: acc.addresses.concat(gs.map(g => ([g, blockNumber])))
                    }), { logs: [] as any, addresses: [] as MonitorAddress[] })
                ))
              .do(x => console.log('NEW_EVENTS_COUNT', x.logs.length))
              .do(({ logs }) => logs.forEach(l => this._em.emit(l._type, l)))
              .mergeMap(({ addresses }) => {
                s.addresses = addresses
                return this._saveState(Object.assign({}, s, { addresses }))
              })
          )
          .retryWhen(errs => errs
            .do(e => console.warn('ERR', e))
            .delay(1000))
      )

  private _monitorTransactions = () =>
    this._transactions
      .mergeMap(t =>
        Observable.timer(0, TRANSACTION_INTERVAL)
          .switchMap(() =>
            Observable.defer(() => this._cfg.getTransactionReceipt(t))
              .catch((err) => {
                console.log('TRANSACTION_MONITORING_ERROR', err)
                return Observable.empty()
              })
          )
          .take(1)
      )

  private _saveState = (s: State) =>
    this._cfg.storage.setItem(KEY_PREFIX + this._cfg.channelManagerAddress, JSON.stringify(s))
}
