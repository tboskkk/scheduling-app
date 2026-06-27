import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const siteUrl = Deno.env.get('SITE_URL') ?? 'http://localhost:5173'

  // Create a client with the calling user's JWT to verify their identity
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const userClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  // Verify the calling user is an authenticated manager
  const { data: { user }, error: userError } = await userClient.auth.getUser()
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Confirm they have a managers row
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  const { data: manager, error: managerError } = await adminClient
    .from('managers')
    .select('organization_id')
    .eq('id', user.id)
    .single()

  if (managerError || !manager) {
    return new Response(JSON.stringify({ error: 'Not a manager' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Parse request body
  let employee_id: string
  try {
    const body = await req.json()
    employee_id = body.employee_id
    if (!employee_id) throw new Error('missing employee_id')
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Fetch the employee — verify they belong to the manager's org
  const { data: employee, error: empError } = await adminClient
    .from('employees')
    .select('id, email, user_id, organization_id')
    .eq('id', employee_id)
    .single()

  if (empError || !employee) {
    return new Response(JSON.stringify({ error: 'Employee not found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (employee.organization_id !== manager.organization_id) {
    return new Response(JSON.stringify({ error: 'Employee does not belong to your organization' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (!employee.email) {
    return new Response(JSON.stringify({ error: 'Employee has no email address' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (employee.user_id) {
    return new Response(JSON.stringify({ error: 'Employee already has an active account' }), {
      status: 409,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Send the invite
  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    employee.email,
    {
      data: {
        employee_id: employee.id,
        organization_id: employee.organization_id,
      },
      redirectTo: `${siteUrl}/employee/setup`,
    }
  )

  if (inviteError) {
    // If the user already exists in auth, look them up and link them directly
    const alreadyExists =
      inviteError.message.toLowerCase().includes('already') ||
      inviteError.message.toLowerCase().includes('registered') ||
      inviteError.message.toLowerCase().includes('exists')

    if (alreadyExists) {
      const { data: listData, error: listError } = await adminClient.auth.admin.listUsers()
      if (listError) {
        return new Response(JSON.stringify({ error: listError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const existingUser = listData.users.find(
        (u) => u.email?.toLowerCase() === employee.email!.toLowerCase()
      )
      if (!existingUser) {
        return new Response(JSON.stringify({ error: inviteError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      // Link the existing auth user to this employee
      const { error: updateError } = await adminClient
        .from('employees')
        .update({ user_id: existingUser.id })
        .eq('id', employee.id)
      if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ success: true, linked: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: inviteError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // If the invite created/returned a user, pre-link user_id so the trigger isn't needed
  if (inviteData?.user?.id) {
    await adminClient
      .from('employees')
      .update({ user_id: inviteData.user.id })
      .eq('id', employee.id)
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
