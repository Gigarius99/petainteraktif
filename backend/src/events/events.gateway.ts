import { 
  WebSocketGateway, 
  WebSocketServer, 
  SubscribeMessage, 
  OnGatewayConnection, 
  OnGatewayDisconnect, 
  MessageBody,
  ConnectedSocket
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinMap')
  handleJoinMap(
    @MessageBody() mapId: string,
    @ConnectedSocket() client: Socket,
  ) {
    client.join(mapId);
    console.log(`Client ${client.id} joined map ${mapId}`);
    // Broadcast to others in the map
    client.to(mapId).emit('userJoined', { clientId: client.id });
    return { event: 'joined', data: mapId };
  }

  @SubscribeMessage('featureUpdated')
  handleFeatureUpdated(
    @MessageBody() payload: { mapId: string; feature: any; action: string },
    @ConnectedSocket() client: Socket,
  ) {
    // Broadcast feature update to everyone else in the map room
    client.to(payload.mapId).emit('onFeatureUpdate', {
      feature: payload.feature,
      action: payload.action,
      updatedBy: client.id
    });
  }
}
