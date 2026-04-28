import { encodeFileName } from './backup.js'

describe('backup', () => {
    describe('encodeFileName', () => {
        test('should return filename', () =>
            expect(encodeFileName('test')).toEqual('test'))

        test('should transform accents', () =>
            expect(encodeFileName('éáíóúôè')).toEqual('eaiouoe'))

        test('should transform other char', () =>
            expect(encodeFileName('A-_*?!@#Z')).toEqual('A-______Z'))
    })
})
