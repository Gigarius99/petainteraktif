import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'crypto';

@Injectable()
export class GeojsonService {
  constructor(private prisma: PrismaService) {}

  async processGeoJSON(file: Express.Multer.File, userId: string) {
    const content = file.buffer.toString('utf-8');
    let geojson: any;

    // 1. Parse JSON
    try {
      geojson = JSON.parse(content);
    } catch {
      throw new Error('File bukan format JSON yang valid');
    }

    if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      throw new Error('File harus berformat GeoJSON FeatureCollection');
    }

    // 2. Pastikan user ada di database — jika tidak, cari user pertama yang ada
    let resolvedUserId = userId;
    try {
      const userExists = await this.prisma.users.findUnique({ where: { id: userId } });
      if (!userExists) {
        // Fallback: ambil user pertama yang ada di DB
        const anyUser = await this.prisma.users.findFirst();
        if (!anyUser) throw new Error('Tidak ada user di database. Silakan daftar dulu.');
        resolvedUserId = anyUser.id;
      }
    } catch (err: any) {
      throw new Error(`Gagal memvalidasi user: ${err.message}`);
    }

    // 3. Buat Map record
    const mapId = randomUUID();
    try {
      await this.prisma.maps.create({
        data: {
          id: mapId,
          user_id: resolvedUserId,
          title: file.originalname,
        },
      });
    } catch (err: any) {
      throw new Error(`Gagal membuat record peta: ${err.message}`);
    }

    // 4. Buat Layer record
    const mapLayerId = randomUUID();
    try {
      await this.prisma.layers.create({
        data: {
          id: mapLayerId,
          map_id: mapId,
          name: file.originalname.replace(/\.[^/.]+$/, '') || 'Layer',
          type: 'geojson',
        },
      });
    } catch (err: any) {
      throw new Error(`Gagal membuat record layer: ${err.message}`);
    }

    // 5. Insert features ke PostGIS
    let inserted = 0;
    let skipped = 0;
    for (const feature of geojson.features) {
      let geometryStr = JSON.stringify(feature.geometry);
      if (!feature.geometry) {
        // Fallback to empty GeometryCollection if missing
        geometryStr = JSON.stringify({ type: 'GeometryCollection', geometries: [] });
      }
      
      const featureId = randomUUID();
      const propertiesStr = JSON.stringify(feature.properties || {});
      try {
        await this.prisma.$executeRaw`
          INSERT INTO "GeoFeatures" (id, layer_id, geometry, properties)
          VALUES (
            ${featureId},
            ${mapLayerId},
            ST_SetSRID(ST_GeomFromGeoJSON(${geometryStr}), 4326),
            ${propertiesStr}::jsonb
          )
        `;
        inserted++;
      } catch (err: any) {
        console.error(`Skipping feature due to geometry error: ${err.message}`);
        skipped++;
      }
    }

    if (inserted === 0) {
      throw new Error(`Tidak ada feature yang berhasil diproses. ${skipped} feature dilewati karena error geometri.`);
    }

    return {
      message: 'GeoJSON berhasil disimpan',
      mapId,
      layerId: mapLayerId,
      totalFeatures: geojson.features.length,
      inserted,
      skipped,
    };
  }

  async getLayerFeatures(layerId: string) {
    const features: any[] = await this.prisma.$queryRaw`
      SELECT id, properties, ST_AsGeoJSON(geometry)::json AS geometry
      FROM "GeoFeatures"
      WHERE layer_id = ${layerId}
    `;

    return {
      type: 'FeatureCollection',
      features: features.map(f => ({
        type: 'Feature',
        id: f.id,
        geometry: f.geometry,
        properties: f.properties,
      })),
    };
  }
}
