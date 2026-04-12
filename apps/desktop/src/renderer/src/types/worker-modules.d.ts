declare module 'monaco-editor/esm/vs/editor/editor.worker?worker' {
  const workerFactory: {
    new (): Worker
  }
  export default workerFactory
}

declare module 'monaco-editor/esm/vs/language/json/json.worker?worker' {
  const workerFactory: {
    new (): Worker
  }
  export default workerFactory
}
