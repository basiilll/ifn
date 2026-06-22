// main (edge-runtime gateway): the self-hosted supabase/edge-runtime container boots with
//   --main-service /home/deno/functions/main
// so EVERY request to /functions/v1/<name> first hits this worker. Its job is to spin up a
// per-function user worker for <name> and proxy the request to it. Without this file the
// runtime crash-loops with "could not find an appropriate entrypoint" and all function calls
// return a non-2xx error at the client.
//
// This is the canonical Supabase main router, trimmed to avoid any boot-time network import
// (status codes are inlined instead of pulling jsr:@std/http/status).

console.log('main function started')

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)
  const { pathname } = url
  const service_name = pathname.split('/')[1]

  if (!service_name || service_name === '') {
    return new Response(JSON.stringify({ msg: 'missing function name in request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const servicePath = `/home/deno/functions/${service_name}`

  const createWorker = async () => {
    const memoryLimitMb = 150
    const workerTimeoutMs = 5 * 60 * 1000
    const noModuleCache = false
    const importMapPath = null

    const envVarsObj = Deno.env.toObject()
    const envVars = Object.keys(envVarsObj).map((k) => [k, envVarsObj[k]])

    const forceCreate = false
    const netAccessDisabled = false
    const cpuTimeSoftLimitMs = 10000
    const cpuTimeHardLimitMs = 20000

    // @ts-ignore EdgeRuntime is injected by the edge-runtime host
    return await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb,
      workerTimeoutMs,
      noModuleCache,
      importMapPath,
      envVars,
      forceCreate,
      netAccessDisabled,
      cpuTimeSoftLimitMs,
      cpuTimeHardLimitMs,
    })
  }

  try {
    const worker = await createWorker()
    const controller = new AbortController()
    return await worker.fetch(req, { signal: controller.signal })
  } catch (e) {
    console.error(e)
    return new Response(JSON.stringify({ msg: (e as Error).toString() }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
