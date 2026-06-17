package com.chatroom.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static final String CHANNEL_ID_MESSAGES = "chat_messages";
    private static final String CHANNEL_ID_GROUP = "chat_group";
    private static final String CHANNEL_ID_SERVICE = "chat_service";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // 创建通知渠道
        createNotificationChannels();
        // 申请运行时权限
        requestRequiredPermissions();
        // 启用 WebView 调试
        WebView.setWebContentsDebuggingEnabled(true);
    }

    /**
     * 创建 Android 8.0+ 通知渠道
     */
    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;

            // 私聊消息渠道
            NotificationChannel chatChannel = new NotificationChannel(
                CHANNEL_ID_MESSAGES,
                "私聊消息",
                NotificationManager.IMPORTANCE_HIGH
            );
            chatChannel.setDescription("接收一对一私聊消息通知");
            chatChannel.enableVibration(true);
            chatChannel.setShowBadge(true);
            manager.createNotificationChannel(chatChannel);

            // 群聊消息渠道
            NotificationChannel groupChannel = new NotificationChannel(
                CHANNEL_ID_GROUP,
                "群聊消息",
                NotificationManager.IMPORTANCE_HIGH
            );
            groupChannel.setDescription("接收群聊消息通知");
            groupChannel.enableVibration(true);
            groupChannel.setShowBadge(true);
            manager.createNotificationChannel(groupChannel);

            // 后台服务渠道
            NotificationChannel serviceChannel = new NotificationChannel(
                CHANNEL_ID_SERVICE,
                "后台运行",
                NotificationManager.IMPORTANCE_LOW
            );
            serviceChannel.setDescription("保持应用后台运行以接收新消息");
            serviceChannel.setShowBadge(false);
            manager.createNotificationChannel(serviceChannel);
        }
    }

    /**
     * 申请所需的运行时权限
     */
    private void requestRequiredPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            java.util.List<String> permissionsNeeded = new java.util.ArrayList<>();

            // 通知权限（Android 13+）
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                    permissionsNeeded.add(Manifest.permission.POST_NOTIFICATIONS);
                }
            }

            // 存储/媒体权限
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_MEDIA_IMAGES)
                    != PackageManager.PERMISSION_GRANTED) {
                    permissionsNeeded.add(Manifest.permission.READ_MEDIA_IMAGES);
                }
            } else {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                    permissionsNeeded.add(Manifest.permission.READ_EXTERNAL_STORAGE);
                }
            }

            if (!permissionsNeeded.isEmpty()) {
                String[] permissions = permissionsNeeded.toArray(new String[0]);
                ActivityCompat.requestPermissions(this, permissions, PERMISSION_REQUEST_CODE);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE) {
            for (int i = 0; i < permissions.length; i++) {
                if (grantResults[i] == PackageManager.PERMISSION_GRANTED) {
                    android.util.Log.i("ChatRoom", "权限已授予: " + permissions[i]);
                } else {
                    android.util.Log.w("ChatRoom", "权限被拒绝: " + permissions[i]);
                }
            }
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // 监听返回键，让 WebView 处理路由返回
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            WebView webView = this.bridge.getWebView();
            if (webView != null && webView.canGoBack()) {
                webView.goBack();
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }
}
