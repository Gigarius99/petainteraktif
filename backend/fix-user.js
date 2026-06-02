const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

async function run() {
  const password = 'peta';
  const hash = await bcrypt.hash(password, 10);
  const isValid = await bcrypt.compare(password, hash);
  console.log('Hash valid?', isValid);
  
  if (!isValid) throw new Error('Bcrypt mismatch!');
  
  const connectionString = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_BcOI07fEGFaR@ep-damp-rain-aopy1luh-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  
  await prisma.users.deleteMany({where: {email: 'peta'}});
  
  const user = await prisma.users.create({
    data: {
      name: 'peta',
      email: 'peta',
      password: hash
    }
  });
  
  console.log('User created:', user);
  await prisma.$disconnect();
  await pool.end();
}

run().catch(console.error);
