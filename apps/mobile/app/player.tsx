import { Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

export default function Player() {
  const source = process.env.EXPO_PUBLIC_DEMO_VIDEO_URL;
  const player = useVideoPlayer(source ?? null);
  return <View style={{ padding: 24, gap: 18 }}>
    <Text>Kiểm chứng M0: video có quyền sử dụng do nhóm cung cấp.</Text>
    {source ? <VideoView player={player} nativeControls style={{ width: '100%', height: 230 }} />
      : <Text>Chưa cấu hình EXPO_PUBLIC_DEMO_VIDEO_URL. Không có video mẫu được tự tải lên.</Text>}
    <Text>Màn này chỉ kiểm tra player; chưa ghi nhận tiến độ và chưa có nguồn RAG.</Text>
  </View>;
}
