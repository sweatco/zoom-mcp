import 'dotenv/config';

const ZOOM_ACCOUNT_ID = process.env.ZOOM_ADMIN_ACCOUNT_ID;
const ZOOM_CLIENT_ID = process.env.ZOOM_ADMIN_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_ADMIN_CLIENT_SECRET;

interface TokenResponse {
  access_token: string;
}

interface Role {
  id: string;
  name: string;
  total_members: number;
}

interface User {
  email: string;
  role_id: string;
  type: number;
}

async function getToken(): Promise<string> {
  const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://zoom.us/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'account_credentials',
      account_id: ZOOM_ACCOUNT_ID!,
    }),
  });
  const data = (await response.json()) as TokenResponse & { scope?: string };
  console.log('Scopes:', data.scope);
  return data.access_token;
}

async function main() {
  const token = await getToken();
  console.log('✅ Got token\n');

  // Get roles
  console.log('=== Roles in Account ===');
  const rolesRes = await fetch('https://api.zoom.us/v2/roles', {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('Roles status:', rolesRes.status);
  const rolesBody = await rolesRes.text();
  console.log('Roles response:', rolesBody);
  const roles = JSON.parse(rolesBody) as { roles: Role[] };
  roles.roles?.forEach((r) => console.log(`  ${r.name} (id: ${r.id}, members: ${r.total_members})`));

  // Get specific users from command line args
  const emails = process.argv.slice(2);

  if (emails.length === 0) {
    console.log('\nUsage: npx tsx scripts/check-roles.ts <email1> [email2] ...');
    return;
  }

  console.log('\n=== User Details ===');
  for (const email of emails) {
    const userRes = await fetch(`https://api.zoom.us/v2/users/${email}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (userRes.ok) {
      const user = (await userRes.json()) as User;
      const roleName = roles.roles?.find((r) => r.id === user.role_id)?.name || 'Unknown';
      console.log(`\n${user.email}:`);
      console.log(`  role_id: ${user.role_id}`);
      console.log(`  role_name: ${roleName}`);
      console.log(`  type: ${user.type} (1=Basic, 2=Licensed, 3=On-prem)`);
    } else {
      console.log(`\n${email}: ${userRes.status} - ${await userRes.text()}`);
    }
  }
}

main().catch(console.error);
