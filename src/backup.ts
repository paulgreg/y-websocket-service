import { yShapeToJSON } from './YShape.js'
import fs from 'node:fs/promises'
import path from 'node:path'

export const encodeFileName = (fileName: string): string => {
    const normalized = fileName.normalize('NFD')

    // Remove accents using a regular expression and replace invalid characters
    const cleanFileName = normalized
        .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
        .replace(/[^a-zA-Z0-9-_.]/g, '_') // Replace invalid characters with '_'

    return cleanFileName
}

const saveJsonToFile = async (
    backupDir: string,
    docName: string,
    json: any,
    idx: number
): Promise<void> => {
    await fs.mkdir(backupDir, { recursive: true })
    const fileName = encodeFileName(docName)
    const filePath = path.join(backupDir, `${fileName}.json`)
    const jsonString = JSON.stringify(json, null, 2)
    await fs.writeFile(filePath, jsonString, 'utf-8')
    console.info(idx, `Successfully backed up ${fileName} to ${filePath}`)
}

export const backupYDoc =
    (backupDir: string, provider: any) => async (): Promise<void> => {
        console.info(new Date(), 'starting backup')
        try {
            const docs = await provider.getAllDocNames()
            console.info(docs.length, 'documents found')
            for (const [idx, docName] of docs.entries()) {
                const ydoc = await provider.getYDoc(docName)
                const json = yShapeToJSON(ydoc)
                await saveJsonToFile(backupDir, docName, json, idx + 1)
            }
            console.info(new Date(), 'backup ended')
        } catch (e) {
            console.error('backup failed', e)
        }
    }
