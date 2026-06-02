import { Module } from '@nestjs/common';
import { GeojsonController } from './geojson.controller';
import { GeojsonService } from './geojson.service';

@Module({
  controllers: [GeojsonController],
  providers: [GeojsonService]
})
export class GeojsonModule {}
