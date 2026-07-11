import { describe, expect, expectTypeOf, it } from 'vitest'

import {
    contentsEqual,
    difference,
    intersection,
    isSubset,
    isSuperset,
    symmetricDifference,
    union,
    unique,
} from './index.js'

type Keyer = (value: unknown) => unknown

const identity: Keyer = (value) => value
const svz = (a: unknown, b: unknown) => a === b || (a !== a && b !== b)

function has(a: readonly unknown[], key: unknown, by: Keyer): boolean {
    for (const value of a) if (svz(by(value), key)) return true
    return false
}

function count(a: readonly unknown[], key: unknown, by: Keyer): number {
    let n = 0
    for (const value of a) if (svz(by(value), key)) n++
    return n
}

function occurrence(a: readonly unknown[], end: number, key: unknown, by: Keyer): number {
    let n = 0
    for (let i = 0; i <= end; i++) if (svz(by(a[i]), key)) n++
    return n
}

function refUnique(a: readonly unknown[], by: Keyer): unknown[] {
    const out: unknown[] = []
    for (let i = 0; i < a.length; i++) {
        const key = by(a[i])
        if (occurrence(a, i, key, by) === 1) out.push(a[i])
    }
    return out
}

function refIntersection(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    by: Keyer
): unknown[] {
    const out: unknown[] = []
    for (let i = 0; i < a.length; i++) {
        const key = by(a[i])
        if (multiset) {
            if (occurrence(a, i, key, by) <= count(b, key, by)) out.push(a[i])
        } else if (occurrence(a, i, key, by) === 1 && has(b, key, by)) {
            out.push(a[i])
        }
    }
    return out
}

function refDifference(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    by: Keyer
): unknown[] {
    const out: unknown[] = []
    for (let i = 0; i < a.length; i++) {
        const key = by(a[i])
        if (multiset) {
            const survivors = Math.max(0, count(a, key, by) - count(b, key, by))
            if (occurrence(a, i, key, by) <= survivors) out.push(a[i])
        } else if (occurrence(a, i, key, by) === 1 && !has(b, key, by)) {
            out.push(a[i])
        }
    }
    return out
}

function refSymmetricDifference(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    by: Keyer
): unknown[] {
    return refDifference(a, b, multiset, by).concat(refDifference(b, a, multiset, by))
}

function refUnion(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    by: Keyer
): unknown[] {
    return multiset
        ? a.slice().concat(refDifference(b, a, true, by))
        : refUnique(a.concat(b), by)
}

function refSubset(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    by: Keyer
): boolean {
    for (const value of a) {
        const key = by(value)
        if (multiset ? count(a, key, by) > count(b, key, by) : !has(b, key, by)) return false
    }
    return true
}

function refContentsEqual(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    by: Keyer
): boolean {
    if (multiset && a.length !== b.length) return false
    return refSubset(a, b, multiset, by) && refSubset(b, a, multiset, by)
}

function expectSameArray(actual: readonly unknown[], expected: readonly unknown[]): void {
    expect(actual.length).toBe(expected.length)
    for (let i = 0; i < expected.length; i++) expect(Object.is(actual[i], expected[i])).toBe(true)
}

function checkAll(
    a: readonly unknown[],
    b: readonly unknown[],
    multiset: boolean,
    by: Keyer = identity
): void {
    const opts = { multiset, by }
    expectSameArray(intersection(a, b, opts), refIntersection(a, b, multiset, by))
    expectSameArray(difference(a, b, opts), refDifference(a, b, multiset, by))
    expectSameArray(
        symmetricDifference(a, b, opts),
        refSymmetricDifference(a, b, multiset, by)
    )
    expectSameArray(union(a, b, opts), refUnion(a, b, multiset, by))
    expect(isSubset(a, b, opts)).toBe(refSubset(a, b, multiset, by))
    expect(isSuperset(a, b, opts)).toBe(refSubset(b, a, multiset, by))
    expect(contentsEqual(a, b, opts)).toBe(refContentsEqual(a, b, multiset, by))
}

function arraysOver(pool: readonly unknown[], maxLength: number): unknown[][] {
    const all: unknown[][] = [[]]
    let level: unknown[][] = [[]]
    for (let length = 1; length <= maxLength; length++) {
        const next: unknown[][] = []
        for (const prefix of level) for (const value of pool) next.push(prefix.concat([value]))
        all.push(...next)
        level = next
    }
    return all
}

function mulberry32(seed: number): () => number {
    return () => {
        seed |= 0
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function randomArray(random: () => number, pool: readonly unknown[], maxLength = 12): unknown[] {
    const length = Math.floor(random() * (maxLength + 1))
    return Array.from({ length }, () => pool[Math.floor(random() * pool.length)])
}

describe('exhaustive and seeded oracle cross-checks', () => {
    it('exhausts every pair over a small SameValueZero pool', () => {
        const all = arraysOver([0, 1, NaN], 4)
        for (const a of all) {
            for (const b of all) {
                checkAll(a, b, false)
                checkAll(a, b, true)
            }
        }
    })

    it('cross-checks thousands of seeded arrays including identity keys', () => {
        const seed = 0x5eedc0de
        const random = mulberry32(seed)
        const one = { name: 'one' }
        const anotherOne = { name: 'one' }
        const two = { name: 'two' }
        const pool = [undefined, null, false, true, -0, +0, 1, 2, NaN, '1', one, anotherOne, two]
        for (let trial = 0; trial < 3_000; trial++) {
            const a = randomArray(random, pool)
            const b = randomArray(random, pool)
            checkAll(a, b, false)
            checkAll(a, b, true)
        }
    })

    it('cross-checks extracted keys with collisions', () => {
        const seed = 0xbadc0de
        const random = mulberry32(seed)
        const pool = Array.from({ length: 12 }, (_, id) => ({ id, key: id % 4 === 3 ? NaN : id % 3 }))
        const by = (value: unknown) => (value as (typeof pool)[number]).key
        for (let trial = 0; trial < 2_000; trial++) {
            const a = randomArray(random, pool)
            const b = randomArray(random, pool)
            checkAll(a, b, false, by)
            checkAll(a, b, true, by)
            expectSameArray(unique(a, by), refUnique(a, by))
        }
    })

    it('crosses the adaptive threshold into Map and Set paths', () => {
        const seed = 0xa11ce
        const random = mulberry32(seed)
        const pool = [undefined, -0, 0, 1, 2, 3, NaN, 'x']
        for (let trial = 0; trial < 300; trial++) {
            const a = randomArray(random, pool, 30)
            const b = randomArray(random, pool, 30)
            checkAll(a, b, false)
            checkAll(a, b, true)
        }
    })
})

describe('properties', () => {
    it('makes sorted paths identical to unsorted paths', () => {
        const seed = 0x5017ed
        const random = mulberry32(seed)
        for (let trial = 0; trial < 2_000; trial++) {
            const a = randomArray(random, [-0, 0, 1, 2, 3, 4], 30) as number[]
            const b = randomArray(random, [-0, 0, 1, 2, 3, 4], 30) as number[]
            a.sort((x, y) => x - y)
            b.sort((x, y) => x - y)
            for (const multiset of [false, true]) {
                const plain = { multiset }
                const sorted = { multiset, sorted: true }
                expectSameArray(intersection(a, b, sorted), intersection(a, b, plain))
                expectSameArray(difference(a, b, sorted), difference(a, b, plain))
                expectSameArray(
                    symmetricDifference(a, b, sorted),
                    symmetricDifference(a, b, plain)
                )
                expectSameArray(union(a, b, sorted), union(a, b, plain))
                expect(isSubset(a, b, sorted)).toBe(isSubset(a, b, plain))
                expect(isSuperset(a, b, sorted)).toBe(isSuperset(a, b, plain))
                expect(contentsEqual(a, b, sorted)).toBe(contentsEqual(a, b, plain))
            }
        }
    })

    it('preserves sorted/unsorted identity with colliding object keys', () => {
        const seed = 0xc0111de
        const random = mulberry32(seed)
        const pool = Array.from({ length: 18 }, (_, id) => ({ id, key: id % 5 }))
        const by = (value: (typeof pool)[number]) => value.key
        for (let trial = 0; trial < 500; trial++) {
            const a = randomArray(random, pool, 25) as (typeof pool)[number][]
            const b = randomArray(random, pool, 25) as (typeof pool)[number][]
            a.sort((x, y) => x.key - y.key)
            b.sort((x, y) => x.key - y.key)
            for (const multiset of [false, true]) {
                const plain = { multiset, by }
                const sorted = { multiset, sorted: true, by }
                expectSameArray(intersection(a, b, sorted), intersection(a, b, plain))
                expectSameArray(difference(a, b, sorted), difference(a, b, plain))
                expectSameArray(
                    symmetricDifference(a, b, sorted),
                    symmetricDifference(a, b, plain)
                )
                expectSameArray(union(a, b, sorted), union(a, b, plain))
                expect(contentsEqual(a, b, sorted)).toBe(contentsEqual(a, b, plain))
            }
        }
    })

    it('agrees between set and multiset mode on duplicate-free inputs', () => {
        const seed = 0xded09
        const random = mulberry32(seed)
        for (let trial = 0; trial < 1_000; trial++) {
            const a = unique(randomArray(random, [0, 1, 2, 3, 4, 5]))
            const b = unique(randomArray(random, [0, 1, 2, 3, 4, 5]))
            expectSameArray(intersection(a, b), intersection(a, b, { multiset: true }))
            expectSameArray(difference(a, b), difference(a, b, { multiset: true }))
            expectSameArray(
                symmetricDifference(a, b),
                symmetricDifference(a, b, { multiset: true })
            )
            expectSameArray(union(a, b), union(a, b, { multiset: true }))
            expect(isSubset(a, b)).toBe(isSubset(a, b, { multiset: true }))
            expect(contentsEqual(a, b)).toBe(contentsEqual(a, b, { multiset: true }))
        }
    })

    it('returns a multiset intersection contained in both inputs and subsequences of a', () => {
        const seed = 0x1a7e25ec
        const random = mulberry32(seed)
        for (let trial = 0; trial < 1_000; trial++) {
            const a = randomArray(random, [0, 1, 2, 3, NaN])
            const b = randomArray(random, [0, 1, 2, 3, NaN])
            const result = intersection(a, b, { multiset: true })
            expect(isSubset(result, a, { multiset: true })).toBe(true)
            expect(isSubset(result, b, { multiset: true })).toBe(true)
            let cursor = 0
            for (const value of result) {
                while (cursor < a.length && !Object.is(a[cursor], value)) cursor++
                expect(cursor).toBeLessThan(a.length)
                cursor++
            }
        }
    })
})

describe('edge contracts', () => {
    it('handles empty arrays and all-duplicate arrays', () => {
        for (const multiset of [false, true]) {
            checkAll([], [], multiset)
            checkAll([1, 1, 1, 1], [], multiset)
            checkAll([], [1, 1, 1, 1], multiset)
            checkAll([1, 1, 1, 1], [1, 1], multiset)
        }
    })

    it('uses SameValueZero for NaN and signed zero', () => {
        const a = [NaN, -0, +0, NaN]
        const b = [NaN, +0]
        for (const multiset of [false, true]) checkAll(a, b, multiset)
        expect(Object.is(intersection([-0], [+0])[0], -0)).toBe(true)
    })

    it('treats sparse holes as undefined', () => {
        const sparseA = Array(3) as (number | undefined)[]
        sparseA[1] = 1
        const sparseB = Array(2) as (number | undefined)[]
        sparseB[1] = 2
        for (const multiset of [false, true]) checkAll(sparseA, sparseB, multiset)
        expectSameArray(intersection(sparseA, sparseB), [undefined])
    })

    it('preserves the first winning occurrences under by collisions', () => {
        const a = [
            { id: 'a1', key: 1 },
            { id: 'a2', key: 1 },
            { id: 'a3', key: 1 },
        ]
        const b = [{ id: 'b1', key: 1 }, { id: 'b2', key: 1 }]
        const by = (x: { key: number }) => x.key
        expectSameArray(intersection(a, b, { multiset: true, by }), a.slice(0, 2))
        expectSameArray(difference(a, b, { multiset: true, by }), a.slice(0, 1))
        expectSameArray(union(b, a, { multiset: true, by }), b.concat(a.slice(0, 1)))
    })

    it('keeps sorted paths correct for NaN and comparison-equivalent non-equals', () => {
        const cases: [unknown[], unknown[]][] = [
            [[NaN, 1], [1, NaN]],
            [[3, 4], ['3', 4]],
            [[NaN], [1]],
        ]
        for (const [a, b] of cases) {
            for (const multiset of [false, true]) {
                const plain = { multiset }
                const sorted = { multiset, sorted: true }
                expectSameArray(intersection(a, b, sorted), intersection(a, b, plain))
                expectSameArray(difference(a, b, sorted), difference(a, b, plain))
                expectSameArray(
                    symmetricDifference(a, b, sorted),
                    symmetricDifference(a, b, plain)
                )
                expectSameArray(union(a, b, sorted), union(a, b, plain))
                expect(isSubset(a, b, sorted)).toBe(isSubset(a, b, plain))
                expect(contentsEqual(a, b, sorted)).toBe(contentsEqual(a, b, plain))
            }
        }
    })
})

describe('types', () => {
    it('accepts readonly arrays and preserves useful result unions', () => {
        const a = [1, 2] as const
        const b = ['x', 'y'] as const
        expectTypeOf(intersection(a, b)).toEqualTypeOf<(1 | 2)[]>()
        expectTypeOf(difference(a, b)).toEqualTypeOf<(1 | 2)[]>()
        expectTypeOf(symmetricDifference(a, b)).toEqualTypeOf<(1 | 2 | 'x' | 'y')[]>()
        expectTypeOf(union(a, b)).toEqualTypeOf<(1 | 2 | 'x' | 'y')[]>()
        expectTypeOf(unique(a)).toEqualTypeOf<(1 | 2)[]>()
        expectTypeOf(isSubset(a, b)).toEqualTypeOf<boolean>()
    })
})
