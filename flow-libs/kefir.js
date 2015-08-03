// jshint ignore:start

declare module kefir {
  declare type Event<T> =
    {type: 'value', value: T, current: boolean} |
    {type: 'error', value: any, current: boolean} |
    {type: 'end', value: void, current: boolean};

  // represents EventStreams and Properties. Yeah, kinda hacky that they're mixed.
  declare class Stream<T> {
    toProperty(): Stream<T>;
    toProperty<U>(getCurrent: ?() => U): Stream<T|U>;
    changes(): Stream<T>;

    onValue(cb: (i: T) => void): void;
    offValue(cb: (i: T) => void): void;
    onError(cb: (err: any) => void): void;
    offError(cb: (err: any) => void): void;
    onEnd(cb: () => void): void;
    offEnd(cb: () => void): void;
    onAny(cb: (event: Event<T>) => void): void;
    offAny(cb: (event: Event<T>) => void): void;
    log(name?: string): Stream<T>;
    offLog(name?: string): Stream<T>;
    toPromise(PromiseConstructor?: Function): Promise<T>;

    map<U>(cb: (i: T) => U): Stream<U>;
    filter(cb?: (i: T) => boolean): Stream<T>;
    take(n: number): Stream<T>;
    takeWhile(cb?: (i: T) => boolean): Stream<T>;
    last(): Stream<T>;
    skip(n: number): Stream<T>;
    skipWhile(cb?: (i: T) => boolean): Stream<T>;
    skipDuplicates(comparator?: (a: T, b: T) => boolean): Stream<T>;
    diff(fn?: (prev: T, next: T) => T, seed?: T): Stream<T>;
    diff<U>(fn: (prev: U, next: T) => T, seed: U): Stream<U>;
    scan(cb: (prev: T, next: T) => T, seed?: T): Stream<T>;
    scan<U>(cb: (prev: U, next: T) => U, seed: U): Stream<U>;
    flatten(): Stream;
    flatten<U>(transformer: (value: T) => U[]): Stream<U>;
    delay(n: number): Stream<T>;
    throttle(n: number, options?: {leading?: boolean, trailing?: boolean}): Stream<T>;
    debounce(n: number, options?: {immediate?: boolean}): Stream<T>;
    valuesToErrors(): Stream;
    valuesToErrors(handler: (value: T) => {convert: boolean, error?: any}): Stream<T>;
    errorsToValues(): Stream<any>;
    errorsToValues<U>(handler: (error: any) => {convert: boolean, value?: U}): Stream<T|U>;
    mapErrors(fn: (error: any) => any): Stream<T>;
    filterErrors(fn: (error: any) => boolean): Stream<T>;
    endOnError(): Stream<T>;
    skipValues(): Stream;
    skipErrors(): Stream<T>;
    skipEnd(): Stream<T>;
    beforeEnd<U>(fn: () => U): Stream<T|U>;
    slidingWindow(max: number, min?: number): Stream<T[]>;
    bufferWhile(predicate?: (value: T) => boolean, options?: {flushOnEnd?: boolean}): Stream<T[]>;
    transduce(transducer: any): Stream;
    withHandler<U>(handler: (emitter: Emitter<U>, event: Event<T>) => void): Stream<U>;

    combine<U>(otherObs: Stream<U>): Stream<[T,U]>;
    combine<U,Z>(otherObs: Stream, combinator: (t: T, u: U) => Z): Stream<Z>;
    zip<U>(otherObs: Stream<U>): Stream<[T,U]>;
    zip<U,Z>(otherObs: Stream<U>, combinator: (t: T, u: U) => Z): Stream<Z>;
    merge<U>(otherObs: Stream<U>): Stream<T|U>;
    concat<U>(otherObs: Stream<U>): Stream<T|U>;

    flatMap(): Stream;
    flatMap<U>(transform: (value: T) => Stream<U>): Stream<U>;
    flatMapLatest(): Stream;
    flatMapLatest<U>(transform: (value: T) => Stream<U>): Stream<U>;
    flatMapFirst(): Stream;
    flatMapFirst<U>(transform: (value: T) => Stream<U>): Stream<U>;
    flatMapConcat(): Stream;
    flatMapConcat<U>(transform: (value: T) => Stream<U>): Stream<U>;
    flatMapLimit(limit: number): Stream;
    flatMapLimit<U>(transform: (value: T) => Stream<U>, limit: number): Stream<U>;
    flatMapErrors(): Stream;
    flatMapErrors<U>(transform: (error: any) => Stream<U>): Stream<T|U>;

    filterBy(otherObs: Stream): Stream<T>;
    sampledBy(otherObs: Stream): Stream<T>;
    sampledBy<U,Z>(otherObs: Stream<U>, combinator: (t: T, u: U) => Z): Stream<Z>;
    skipUntilBy(otherObs: Stream): Stream<T>;
    takeUntilBy(otherObs: Stream): Stream<T>;
    bufferBy(otherObs: Stream, options?: {flushOnEnd?: boolean}): Stream<T[]>;
    bufferWhileBy(otherObs: Stream, options?: {flushOnEnd?: boolean, flushOnChange?: boolean}): Stream<T[]>;
    awaiting(otherObs: Stream): Stream<boolean>;
  }

  declare class Emitter<T> extends Stream<T> {
    emit(value: T): boolean;
    error(e: any): boolean;
    emitEvent(event: Event<T>): boolean;
    end(): void;
  }

  declare class Pool<T> extends Stream<T> {
    plug(s: Stream<T>): () => void;
  }

  declare class Bus<T> extends Emitter<T> {
    plug(s: Stream<T>): () => void;
  }

  declare function never(): Stream;
  declare function later<T>(delay: number, value: T): Stream<T>;
  declare function interval<T>(interval: number, value: T): Stream<T>;
  declare function sequentially<T>(interval: number, values: T[]): Stream<T>;
  declare function fromPoll<T>(interval: number, f: () => T): Stream<T>;
  declare function withInterval<T>(interval: number, f: (emitter: Emitter<T>) => void): Stream<T>;
  declare function fromCallback<T>(f: (cb: (value: T) => void) => void): Stream<T>;
  declare function fromNodeCallback<T>(f: (cb: (err: any, value: ?T) => void) => void): Stream<T>;
  declare function fromEvents(target: Object, eventName: string, transformer?: (event: any) => any): Stream;
  declare function stream<T>(subscribe: (emitter: Emitter<T>) => ?() => void): Stream<T>;

  declare function constant<T>(value: T): Stream<T>;
  declare function constantError(err: any): Stream;
  declare function fromPromise<T>(promise: Promise<T>): Stream<T>;

  declare function combine<A,B,C,D>(obss: [Stream<A>, Stream<B>, Stream<C>, Stream<D>]): Stream<[A,B,C,D]>;
  declare function combine<T,U>(obss: Stream<T>[], passiveObss?: Stream<U>[]): Stream<Array<T|U>>;
  declare function combine(obss: Stream[], passiveObss: Stream[], combinator: Function): Stream;
  declare function zip<A,B,C,D>(obss: [Stream<A>, Stream<B>, Stream<C>, Stream<D>]): Stream<[A,B,C,D]>;
  declare function zip<T>(obss: Stream<T>[]): Stream<Array<T>>;
  declare function zip(obss: Stream[], combinator: Function): Stream;
  declare function merge<A,B,C,D>(obss: [Stream<A>, Stream<B>, Stream<C>, Stream<D>]): Stream<A|B|C|D>;
  declare function merge<T>(obss: Stream<T>[]): Stream<T>;
  declare function concat<A,B,C,D>(obss: [Stream<A>, Stream<B>, Stream<C>, Stream<D>]): Stream<A|B|C|D>;
  declare function concat<T>(obss: Stream<T>[]): Stream<T>;

  declare function pool(): Pool;
  declare function repeat<T>(fn: (i: number) => Stream<T>): Stream<T>;
}