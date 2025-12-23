import * as Y from 'yjs'

/**
 * Guess AbstractType
 *
 * Don't use it in production!
 * See https://github.com/yjs/yjs/issues/563
 */
export function guessType (abstractType) {
  if (abstractType.constructor === Y.Array) {
    return Y.Array
  }
  if (abstractType.constructor === Y.Map) {
    return Y.Map
  }
  if (abstractType._map.size) {
    return Y.Map
  }
  if (abstractType._length > 0) {
    const firstItem = abstractType._first
    if (!firstItem) {
      console.error(
        'The length is greater than 0 but _first is not set',
        abstractType
      )
      return Y.AbstractType
    }

    // Try distinguish between Y.Text and Y.Array
    // Only check the first element, it's unreliable!
    if (
      firstItem.content instanceof Y.ContentString ||
            firstItem.content instanceof Y.ContentFormat
    ) {
      return Y.Text
    }
    return Y.Array
  }
  return Y.AbstractType
}

export function getYTypeName (value) {
  if (value instanceof Y.Doc) {
    return 'YDoc'
  }
  if (value instanceof Y.Map) {
    return 'YMap'
  }
  if (value instanceof Y.Array) {
    return 'YArray'
  }
  if (value instanceof Y.Text) {
    return 'YText'
  }
  if (value instanceof Y.XmlElement) {
    return 'YXmlElement'
  }
  if (value instanceof Y.XmlFragment) {
    return 'YXmlFragment'
  }
  if (value instanceof Y.AbstractType) {
    return 'YAbstractType'
  }
  console.error('Unknown Yjs type', value)
  throw new Error('Unknown Yjs type')
}

export function isYDoc (value) {
  return value instanceof Y.Doc
}

export function isYMap (value) {
  return value instanceof Y.Map
}

export function isYArray (value) {
  return value instanceof Y.Array
}

export function isYText (value) {
  return value instanceof Y.Text
}

export function isYXmlElement (value) {
  return value instanceof Y.XmlElement
}

export function isYXmlFragment (value) {
  return value instanceof Y.XmlFragment
}

export function isYXmlText (value) {
  return value instanceof Y.XmlText
}

/**
 * Check if the value is a Y.AbstractType.
 *
 * **Note: Y.Doc is not a Y.AbstractType.**
 *
 * See also {@link isYShape}
 */
export function isYAbstractType (value) {
  return value instanceof Y.AbstractType
}

/**
 * Check if the value is a Yjs type. It includes Y.Doc and Y.AbstractType.
 *
 * See also {@link isYAbstractType}
 */
export function isYShape (value) {
  return isYDoc(value) || isYAbstractType(value)
}

export function parseYShape (value, { showDelta } = { showDelta: true }) {
  if (isYDoc(value)) {
    const yDoc = value
    const keys = Array.from(yDoc.share.keys())
    const obj = keys.reduce((acc, key) => {
      const value = yDoc.get(key)
      const type = guessType(value)
      acc[key] = yDoc.get(key, type)
      return acc
    }, {})
    return obj
  }

  if (isYMap(value)) {
    const yMap = value
    const keys = Array.from(yMap.keys())
    const obj = keys.reduce((acc, key) => {
      acc[key] = yMap.get(key)
      return acc
    }, {})
    return obj
  }

  if (isYArray(value)) {
    const yArray = value
    const arr = yArray.toArray()
    return arr
  }

  if (isYText(value)) {
    if (showDelta) {
      return value.toDelta()
    }
    return value.toString()
  }

  if (isYXmlElement(value)) {
    return {
      nodeName: value.nodeName,
      attributes: value.getAttributes(),
      'toString()': value.toString()
    }
  }

  if (isYXmlFragment(value)) {
    return value.toJSON()
  }

  if (isYXmlText(value)) {
    if (showDelta) {
      return value.toDelta()
    }
    return value.toString()
  }

  return value
}

export const NATIVE_UNIQ_IDENTIFIER = '$yjs:internal:native$'

export function yShapeToJSON (value) {
  if (!isYShape(value)) {
    return value
  }
  const typeName = getYTypeName(value)

  if (isYDoc(value)) {
    const yDoc = value
    const keys = Array.from(yDoc.share.keys())
    const obj = keys.reduce((acc, key) => {
      const val = yDoc.get(key)
      const type = guessType(val)
      acc[key] = yShapeToJSON(yDoc.get(key, type))
      return acc
    }, {})
    return obj
  }
  if (isYMap(value)) {
    const yMap = value
    const keys = Array.from(yMap.keys())
    const obj = keys.reduce((acc, key) => {
      acc[key] = yShapeToJSON(yMap.get(key))
      return acc
    }, {})
    return obj
  }
  if (isYArray(value)) {
    return value.toArray().map((value) => yShapeToJSON(value))
  }
  if (isYText(value)) {
    return value.toJSON()
  }
  if (isYXmlElement(value)) {
    return {
      nodeName: value.nodeName,
      attributes: value.getAttributes()
    }
  }
  if (isYXmlFragment(value)) {
    return value.toJSON()
  }
  if (isYAbstractType(value)) {
    console.error('Unsupported Yjs type: ' + typeName, value)
    throw new Error('Unsupported Yjs type: ' + typeName)
  }
  console.error('Unknown Yjs type', value)
  throw new Error('Unknown Yjs type ' + value)
}
