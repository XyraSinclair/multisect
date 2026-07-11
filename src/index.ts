/** Options shared by every binary operation. */
export type Opts<T> = {
    /** Count repeated keys instead of deduplicating them. Default: false. */
    multiset?: boolean
    /** Assert that both inputs ascend under `<` on their values or keys. */
    sorted?: boolean
    /** Compare extracted keys while returning the original elements. */
    by?: (x: T) => unknown
}

type Keyer = (value: unknown) => unknown

/* Measured on Node 24.13.1 / Apple Silicon by `npm run bench`: below this
 * amount of pair work, nested scans avoid the Map/Set construction cost. */
const TINY_PAIR_WORK = 160

const identity: Keyer = (value) => value

function sameValueZero(a: unknown, b: unknown): boolean {
    return a === b || (a !== a && b !== b)
}

function keyerFor<T>(by: Opts<T>['by']): Keyer {
    return (by as Keyer | undefined) ?? identity
}

function isTiny(a: readonly unknown[], b: readonly unknown[]): boolean {
    return a.length > 0 && b.length > 0 && a.length * b.length <= TINY_PAIR_WORK
}

/* union/symmetricDifference scan both directions, so their nested work is
 * O((m+n)²), not O(m·n) — an asymmetric pair like (160, 1) passes the m·n
 * gate yet does 160× the pair work of the map path. Gate them on the
 * square of the total size instead. */
function isTinyBoth(a: readonly unknown[], b: readonly unknown[]): boolean {
    const n = a.length + b.length
    return a.length > 0 && b.length > 0 && n * n <= TINY_PAIR_WORK
}

function hasKey(a: readonly unknown[], key: unknown, keyOf: Keyer): boolean {
    for (let i = 0; i < a.length; i++) {
        if (sameValueZero(keyOf(a[i]), key)) return true
    }
    return false
}

function hasKeyBefore(
    a: readonly unknown[],
    end: number,
    key: unknown,
    keyOf: Keyer
): boolean {
    for (let i = 0; i < end; i++) {
        if (sameValueZero(keyOf(a[i]), key)) return true
    }
    return false
}

function countKey(a: readonly unknown[], key: unknown, keyOf: Keyer): number {
    let count = 0
    for (let i = 0; i < a.length; i++) {
        if (sameValueZero(keyOf(a[i]), key)) count++
    }
    return count
}

function countKeyBefore(
    a: readonly unknown[],
    end: number,
    key: unknown,
    keyOf: Keyer
): number {
    let count = 0
    for (let i = 0; i < end; i++) {
        if (sameValueZero(keyOf(a[i]), key)) count++
    }
    return count
}

function nestedIntersection(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): unknown[] {
    const out: unknown[] = []
    for (let i = 0; i < a.length; i++) {
        const key = keyOf(a[i])
        if (multiset) {
            const occurrence = countKeyBefore(a, i, key, keyOf) + 1
            if (occurrence <= countKey(b, key, keyOf)) out.push(a[i])
        } else if (!hasKeyBefore(a, i, key, keyOf) && hasKey(b, key, keyOf)) {
            out.push(a[i])
        }
    }
    return out
}

function mapIntersection(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): unknown[] {
    const out: unknown[] = []
    if (!multiset) {
        const remaining = new Set<unknown>()
        for (const value of b) remaining.add(keyOf(value))
        for (const value of a) {
            const key = keyOf(value)
            if (remaining.delete(key)) out.push(value)
        }
        return out
    }

    const remaining = countsOf(b, keyOf)
    for (const value of a) {
        const key = keyOf(value)
        const count = remaining.get(key) ?? 0
        if (count > 0) {
            out.push(value)
            if (count === 1) remaining.delete(key)
            else remaining.set(key, count - 1)
        }
    }
    return out
}

function nestedDifference(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): unknown[] {
    const out: unknown[] = []
    for (let i = 0; i < a.length; i++) {
        const key = keyOf(a[i])
        if (multiset) {
            const keep = countKey(a, key, keyOf) - countKey(b, key, keyOf)
            const occurrence = countKeyBefore(a, i, key, keyOf) + 1
            if (occurrence <= keep) out.push(a[i])
        } else if (!hasKeyBefore(a, i, key, keyOf) && !hasKey(b, key, keyOf)) {
            out.push(a[i])
        }
    }
    return out
}

function mapDifference(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): unknown[] {
    const out: unknown[] = []
    if (!multiset) {
        const excludedOrEmitted = new Set<unknown>()
        for (const value of b) excludedOrEmitted.add(keyOf(value))
        for (const value of a) {
            const key = keyOf(value)
            if (!excludedOrEmitted.has(key)) {
                excludedOrEmitted.add(key)
                out.push(value)
            }
        }
        return out
    }

    const keep = countsOf(a, keyOf)
    for (const value of b) {
        const key = keyOf(value)
        const count = keep.get(key) ?? 0
        if (count > 0) keep.set(key, count - 1)
    }
    for (const value of a) {
        const key = keyOf(value)
        const count = keep.get(key) ?? 0
        if (count > 0) {
            out.push(value)
            if (count === 1) keep.delete(key)
            else keep.set(key, count - 1)
        }
    }
    return out
}

function nestedSymmetricDifference(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): unknown[] {
    return nestedDifference(a, b, multiset, keyOf).concat(
        nestedDifference(b, a, multiset, keyOf)
    )
}

function mapSymmetricDifference(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): unknown[] {
    return mapDifference(a, b, multiset, keyOf).concat(
        mapDifference(b, a, multiset, keyOf)
    )
}

function nestedUnion(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): unknown[] {
    if (!multiset) return nestedUnique(a.concat(b), keyOf)
    return a.slice().concat(nestedDifference(b, a, true, keyOf))
}

function mapUnion(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): unknown[] {
    if (!multiset) return mapUnique(a.concat(b), keyOf)
    return a.slice().concat(mapDifference(b, a, true, keyOf))
}

function countsOf(a: readonly unknown[], keyOf: Keyer): Map<unknown, number> {
    const counts = new Map<unknown, number>()
    for (const value of a) {
        const key = keyOf(value)
        counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
}

function nestedSubset(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): boolean {
    for (let i = 0; i < a.length; i++) {
        const key = keyOf(a[i])
        if (multiset) {
            if (countKeyBefore(a, i, key, keyOf) + 1 > countKey(b, key, keyOf)) return false
        } else if (!hasKey(b, key, keyOf)) {
            return false
        }
    }
    return true
}

function mapSubset(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): boolean {
    if (!multiset) {
        const available = new Set<unknown>()
        for (const value of b) available.add(keyOf(value))
        for (const value of a) {
            if (!available.has(keyOf(value))) return false
        }
        return true
    }

    if (a.length > b.length) return false
    const available = countsOf(b, keyOf)
    for (const value of a) {
        const key = keyOf(value)
        const count = available.get(key) ?? 0
        if (count === 0) return false
        if (count === 1) available.delete(key)
        else available.set(key, count - 1)
    }
    return true
}

function nestedContentsEqual(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): boolean {
    if (multiset && a.length !== b.length) return false
    return nestedSubset(a, b, multiset, keyOf) && nestedSubset(b, a, multiset, keyOf)
}

function mapContentsEqual(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): boolean {
    if (multiset) {
        if (a.length !== b.length) return false
        const counts = countsOf(a, keyOf)
        for (const value of b) {
            const key = keyOf(value)
            const count = counts.get(key) ?? 0
            if (count === 0) return false
            if (count === 1) counts.delete(key)
            else counts.set(key, count - 1)
        }
        return counts.size === 0
    }

    const aKeys = new Set<unknown>()
    const bKeys = new Set<unknown>()
    for (const value of a) aKeys.add(keyOf(value))
    for (const value of b) bKeys.add(keyOf(value))
    if (aKeys.size !== bKeys.size) return false
    for (const key of aKeys) if (!bKeys.has(key)) return false
    return true
}

function nestedUnique(a: readonly unknown[], keyOf: Keyer): unknown[] {
    const out: unknown[] = []
    for (let i = 0; i < a.length; i++) {
        const key = keyOf(a[i])
        if (!hasKeyBefore(a, i, key, keyOf)) out.push(a[i])
    }
    return out
}

function mapUnique(a: readonly unknown[], keyOf: Keyer): unknown[] {
    const seen = new Set<unknown>()
    const out: unknown[] = []
    for (const value of a) {
        const key = keyOf(value)
        if (!seen.has(key)) {
            seen.add(key)
            out.push(value)
        }
    }
    return out
}

/* `0` means comparison-equivalent. The caller checks SameValueZero first, so
 * `0` can also expose values (NaN, distinct objects, 3 and '3') for which `<`
 * does not provide a usable merge order. */
function compareKeys(a: unknown, b: unknown): -1 | 0 | 1 {
    if (sameValueZero(a, b)) return 0
    // The sorted contract explicitly asserts comparability under `<`.
    if ((a as never) < (b as never)) return -1
    if ((b as never) < (a as never)) return 1
    return 0
}

/* Scans one array's keys: returns true on an adjacent pair that is neither
 * SameValueZero-equal nor ordered under `<`, and records whether string and
 * non-string keys were seen (for the cross-stream type-mix gate below). */
function scanSortedKeys(
    a: readonly unknown[],
    keyOf: Keyer,
    seen: { str: boolean; nonStr: boolean }
): boolean {
    if (a.length === 0) return false
    let previous = keyOf(a[0])
    if (typeof previous === 'string') seen.str = true
    else seen.nonStr = true
    for (let i = 1; i < a.length; i++) {
        const current = keyOf(a[i])
        if (typeof current === 'string') seen.str = true
        else seen.nonStr = true
        if (!sameValueZero(previous, current) && compareKeys(previous, current) === 0) return true
        previous = current
    }
    return false
}

/* The sorted merge assumes `<` behaves like an order on the keys at hand.
 * Two ways that fails, each sending us to the nested reference path:
 *
 * 1. Incomparability — an adjacent (here) or in-merge (the sentinel in
 *    appendSortedDifference et al.) pair with no `<` verdict either way.
 * 2. CYCLES — `<` compares two strings lexically and everything else
 *    numerically, and the two orders can disagree: '10' < '2' (lexical),
 *    '2' < 3 (numeric), 3 < '10' (numeric). Every pairwise comparison is
 *    decisive, so no sentinel can fire — yet transitivity is gone, SVZ-equal
 *    keys need not be adjacent in a validly ascending array, and the merge
 *    silently skips runs. Each order is total and transitive on its own
 *    domain, so a cycle REQUIRES both a string pair (compared lexically)
 *    and a numeric bridge — i.e. string keys mixed with non-string keys
 *    across the two streams. That mixture is exactly what we detect.
 */
function sortedPathUnsafe(a: readonly unknown[], b: readonly unknown[], keyOf: Keyer): boolean {
    const seen = { str: false, nonStr: false }
    if (scanSortedKeys(a, keyOf, seen)) return true
    if (scanSortedKeys(b, keyOf, seen)) return true
    return seen.str && seen.nonStr
}

function runEnd(a: readonly unknown[], start: number, key: unknown, keyOf: Keyer): number {
    let end = start + 1
    while (end < a.length && sameValueZero(keyOf(a[end]), key)) end++
    return end
}

function appendFirst(out: unknown[], a: readonly unknown[], start: number, count: number): void {
    for (let i = 0; i < count; i++) out.push(a[start + i])
}

function sortedIntersection(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): unknown[] {
    if (sortedPathUnsafe(a, b, keyOf)) {
        return nestedIntersection(a, b, multiset, keyOf)
    }
    const out: unknown[] = []
    let ai = 0
    let bi = 0
    while (ai < a.length && bi < b.length) {
        const ak = keyOf(a[ai])
        const bk = keyOf(b[bi])
        if (sameValueZero(ak, bk)) {
            const ae = runEnd(a, ai, ak, keyOf)
            const be = runEnd(b, bi, bk, keyOf)
            appendFirst(out, a, ai, multiset ? Math.min(ae - ai, be - bi) : 1)
            ai = ae
            bi = be
        } else {
            const order = compareKeys(ak, bk)
            if (order === 0) return nestedIntersection(a, b, multiset, keyOf)
            if (order < 0) ai = runEnd(a, ai, ak, keyOf)
            else bi = runEnd(b, bi, bk, keyOf)
        }
    }
    return out
}

/* Returns false when a cross-array key pair is neither SameValueZero-equal
 * nor ordered under `<` (e.g. 1 vs 'a'): the merge cannot know whether a
 * matching partner exists further along, so the caller must discard any
 * partial output and fall back to the nested reference path — exactly as
 * sortedIntersection and sortedSubset already do. Skipping instead would
 * silently lose cancellations (and even emit duplicates in set-mode union). */
function appendSortedDifference(
    out: unknown[],
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): boolean {
    let ai = 0
    let bi = 0
    while (ai < a.length && bi < b.length) {
        const ak = keyOf(a[ai])
        const bk = keyOf(b[bi])
        const ae = runEnd(a, ai, ak, keyOf)
        if (sameValueZero(ak, bk)) {
            const be = runEnd(b, bi, bk, keyOf)
            if (multiset) appendFirst(out, a, ai, Math.max(0, ae - ai - (be - bi)))
            ai = ae
            bi = be
        } else {
            const order = compareKeys(ak, bk)
            if (order === 0) return false
            if (order < 0) {
                appendFirst(out, a, ai, multiset ? ae - ai : 1)
                ai = ae
            } else {
                bi = runEnd(b, bi, bk, keyOf)
            }
        }
    }
    while (ai < a.length) {
        const key = keyOf(a[ai])
        const end = runEnd(a, ai, key, keyOf)
        appendFirst(out, a, ai, multiset ? end - ai : 1)
        ai = end
    }
    return true
}

function sortedDifference(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): unknown[] {
    if (sortedPathUnsafe(a, b, keyOf)) {
        return nestedDifference(a, b, multiset, keyOf)
    }
    const out: unknown[] = []
    if (!appendSortedDifference(out, a, b, multiset, keyOf))
        return nestedDifference(a, b, multiset, keyOf)
    return out
}

function sortedSymmetricDifference(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): unknown[] {
    if (sortedPathUnsafe(a, b, keyOf)) {
        return nestedSymmetricDifference(a, b, multiset, keyOf)
    }
    const out: unknown[] = []
    if (
        !appendSortedDifference(out, a, b, multiset, keyOf) ||
        !appendSortedDifference(out, b, a, multiset, keyOf)
    )
        return nestedSymmetricDifference(a, b, multiset, keyOf)
    return out
}

function appendSortedUnique(out: unknown[], a: readonly unknown[], keyOf: Keyer): void {
    let i = 0
    while (i < a.length) {
        out.push(a[i])
        i = runEnd(a, i, keyOf(a[i]), keyOf)
    }
}

function sortedUnion(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): unknown[] {
    if (sortedPathUnsafe(a, b, keyOf)) {
        return nestedUnion(a, b, multiset, keyOf)
    }
    const out: unknown[] = []
    if (multiset) appendFirst(out, a, 0, a.length)
    else appendSortedUnique(out, a, keyOf)
    if (!appendSortedDifference(out, b, a, multiset, keyOf))
        return nestedUnion(a, b, multiset, keyOf)
    return out
}

function sortedSubset(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): boolean {
    if (sortedPathUnsafe(a, b, keyOf)) {
        return nestedSubset(a, b, multiset, keyOf)
    }
    let ai = 0
    let bi = 0
    while (ai < a.length && bi < b.length) {
        const ak = keyOf(a[ai])
        const bk = keyOf(b[bi])
        if (sameValueZero(ak, bk)) {
            const ae = runEnd(a, ai, ak, keyOf)
            const be = runEnd(b, bi, bk, keyOf)
            if (multiset && ae - ai > be - bi) return false
            ai = ae
            bi = be
        } else {
            const order = compareKeys(ak, bk)
            if (order === 0) return nestedSubset(a, b, multiset, keyOf)
            if (order < 0) return false
            bi = runEnd(b, bi, bk, keyOf)
        }
    }
    return ai === a.length
}

function sortedContentsEqual(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    keyOf: Keyer
): boolean {
    if (sortedPathUnsafe(a, b, keyOf)) {
        return nestedContentsEqual(a, b, multiset, keyOf)
    }
    if (multiset && a.length !== b.length) return false
    let ai = 0
    let bi = 0
    while (ai < a.length && bi < b.length) {
        const ak = keyOf(a[ai])
        const bk = keyOf(b[bi])
        if (!sameValueZero(ak, bk)) return false
        const ae = runEnd(a, ai, ak, keyOf)
        const be = runEnd(b, bi, bk, keyOf)
        if (multiset && ae - ai !== be - bi) return false
        ai = ae
        bi = be
    }
    return ai === a.length && bi === b.length
}

/** Shared keys, represented by the winning occurrences from `a`. */
export function intersection<A, B>(
    a: readonly A[],
    b: readonly B[],
    opts: Opts<A | B> = {}
): A[] {
    const keyOf = keyerFor(opts.by)
    const multiset = opts.multiset === true
    const rawA = a as readonly unknown[]
    const rawB = b as readonly unknown[]
    const out = opts.sorted
        ? sortedIntersection(rawA, rawB, multiset, keyOf)
        : isTiny(rawA, rawB)
          ? nestedIntersection(rawA, rawB, multiset, keyOf)
          : mapIntersection(rawA, rawB, multiset, keyOf)
    return out as A[]
}

/** Keys in `a` but not `b`, represented by occurrences from `a`. */
export function difference<A, B>(
    a: readonly A[],
    b: readonly B[],
    opts: Opts<A | B> = {}
): A[] {
    const keyOf = keyerFor(opts.by)
    const multiset = opts.multiset === true
    const rawA = a as readonly unknown[]
    const rawB = b as readonly unknown[]
    const out = opts.sorted
        ? sortedDifference(rawA, rawB, multiset, keyOf)
        : isTiny(rawA, rawB)
          ? nestedDifference(rawA, rawB, multiset, keyOf)
          : mapDifference(rawA, rawB, multiset, keyOf)
    return out as A[]
}

/** `a` survivors followed by `b` survivors. */
export function symmetricDifference<A, B>(
    a: readonly A[],
    b: readonly B[],
    opts: Opts<A | B> = {}
): (A | B)[] {
    const keyOf = keyerFor(opts.by)
    const multiset = opts.multiset === true
    const rawA = a as readonly unknown[]
    const rawB = b as readonly unknown[]
    const out = opts.sorted
        ? sortedSymmetricDifference(rawA, rawB, multiset, keyOf)
        : isTinyBoth(rawA, rawB)
          ? nestedSymmetricDifference(rawA, rawB, multiset, keyOf)
          : mapSymmetricDifference(rawA, rawB, multiset, keyOf)
    return out as (A | B)[]
}

/** Set union, or the maximum count of each key in multiset mode. */
export function union<A, B>(
    a: readonly A[],
    b: readonly B[],
    opts: Opts<A | B> = {}
): (A | B)[] {
    const keyOf = keyerFor(opts.by)
    const multiset = opts.multiset === true
    const rawA = a as readonly unknown[]
    const rawB = b as readonly unknown[]
    const out = opts.sorted
        ? sortedUnion(rawA, rawB, multiset, keyOf)
        : isTinyBoth(rawA, rawB)
          ? nestedUnion(rawA, rawB, multiset, keyOf)
          : mapUnion(rawA, rawB, multiset, keyOf)
    return out as (A | B)[]
}

/** Whether every key/count in `a` is available in `b`. */
export function isSubset<A, B>(
    a: readonly A[],
    b: readonly B[],
    opts: Opts<A | B> = {}
): boolean {
    const keyOf = keyerFor(opts.by)
    const multiset = opts.multiset === true
    const rawA = a as readonly unknown[]
    const rawB = b as readonly unknown[]
    if (multiset && a.length > b.length) return false
    return opts.sorted
        ? sortedSubset(rawA, rawB, multiset, keyOf)
        : isTiny(rawA, rawB)
          ? nestedSubset(rawA, rawB, multiset, keyOf)
          : mapSubset(rawA, rawB, multiset, keyOf)
}

/** Whether every key/count in `b` is available in `a`. */
export function isSuperset<A, B>(
    a: readonly A[],
    b: readonly B[],
    opts: Opts<A | B> = {}
): boolean {
    return isSubset(b, a, opts)
}

/** Whether both arrays contain the same set or multiset of keys. */
export function contentsEqual<A, B>(
    a: readonly A[],
    b: readonly B[],
    opts: Opts<A | B> = {}
): boolean {
    const keyOf = keyerFor(opts.by)
    const multiset = opts.multiset === true
    const rawA = a as readonly unknown[]
    const rawB = b as readonly unknown[]
    return opts.sorted
        ? sortedContentsEqual(rawA, rawB, multiset, keyOf)
        : isTiny(rawA, rawB)
          ? nestedContentsEqual(rawA, rawB, multiset, keyOf)
          : mapContentsEqual(rawA, rawB, multiset, keyOf)
}

/** Order-preserving SameValueZero deduplication, optionally by extracted key. */
export function unique<T>(a: readonly T[], by?: (x: T) => unknown): T[] {
    const raw = a as readonly unknown[]
    const keyOf = keyerFor(by)
    const out = raw.length * raw.length <= TINY_PAIR_WORK
        ? nestedUnique(raw, keyOf)
        : mapUnique(raw, keyOf)
    return out as T[]
}
