import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.users.findUnique({ where: { email } });
  }

  async findById(id: string) {
    return this.prisma.users.findUnique({ where: { id } });
  }

  async create(data: any) {
    return this.prisma.users.create({ data });
  }
}
