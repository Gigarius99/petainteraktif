import {
  Controller, Post, Get, Param,
  UseInterceptors, UploadedFile, UseGuards,
  Req, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { GeojsonService } from './geojson.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('geojson')
export class GeojsonController {
  private readonly logger = new Logger(GeojsonController.name);

  constructor(private readonly geojsonService: GeojsonService) {}

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File, @Req() req: any) {
    if (!file) {
      throw new HttpException('File tidak ditemukan dalam request', HttpStatus.BAD_REQUEST);
    }

    const userId: string = req.user?.userId ?? 'unknown';
    this.logger.log(`Upload request - userId: ${userId}, file: ${file.originalname}, size: ${file.size}`);

    try {
      const result = await this.geojsonService.processGeoJSON(file, userId);
      this.logger.log(`Upload sukses - layerId: ${result.layerId}, inserted: ${result.inserted}`);
      return result;
    } catch (err: any) {
      this.logger.error(`Upload gagal: ${err.message}`);
      throw new HttpException(
        { message: err.message || 'Terjadi kesalahan saat memproses file' },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // Public endpoint — tidak perlu login
  @Get('layer/:id')
  async getLayer(@Param('id') id: string) {
    try {
      return await this.geojsonService.getLayerFeatures(id);
    } catch (err: any) {
      throw new HttpException(
        { message: `Gagal mengambil layer: ${err.message}` },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
