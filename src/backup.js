import { yShapeToJSON } from './YShape.js'
import fs from 'fs/promises'
import path from 'path'

const encodeFileName = (fileName) => {
    const normalized = fileName.normalize('NFD')

    // Remove accents using a regular expression and replace invalid characters
    const cleanFileName = normalized
        .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
        .replace(/[^a-zA-Z0-9-_.]/g, '_') // Replace invalid characters with '_'

    return cleanFileName
}

const saveJsonToFile = async (backupDir, docName, json, idx) => {
    await fs.mkdir(backupDir, { recursive: true })
    const fileName = encodeFileName(docName)
    const filePath = path.join(backupDir, `${fileName}.json`)
    const jsonString = JSON.stringify(json, null, 2)
    await fs.writeFile(filePath, jsonString, 'utf-8')
    console.log(idx, `Successfully backed up ${fileName} to ${filePath}`)
}

export const backupYDoc = (backupDir, provider) => async () => {
    console.log(new Date(), 'starting backup')
    try {
        const docs = await provider.getAllDocNames()
        console.log(docs.length, 'documents found')
        for (const [idx, docName] of docs.entries()) {
            const ydoc = await provider.getYDoc(docName)
            const json = yShapeToJSON(ydoc)
            await saveJsonToFile(backupDir, docName, json, idx + 1)
        }
        console.log(new Date(), 'backup ended')
    } catch (e) {
        console.error('backup failed', e)
    }
}
