export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initDatabase } = await import('./lib/db')
    const { startJobQueue } = await import('./lib/job-queue')
    await initDatabase()
    startJobQueue()
  }
}
