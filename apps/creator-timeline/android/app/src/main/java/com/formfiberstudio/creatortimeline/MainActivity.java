package com.formfiberstudio.creatortimeline;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DateFilteredPhotoPickerPlugin.class);
        registerPlugin(SharedPhotosPlugin.class);
        super.onCreate(savedInstanceState);

        // Capacitor leaves the back gesture / button to the system, which closes the
        // app outright -- whatever screen the calendar is on. The calendar keeps its own
        // trail in the web page's history (src/App.jsx, "IN-APP BACK STACK": every
        // screen change and every open settings / day / drawer layer is an entry), so
        // back is handed to that: a step back in the page if there is one, and only
        // when there is nothing left does it leave the app.
        //
        // The page says how many entries are still worth going back to
        // (window.__calendarLiveBack) -- its history can also hold slots that are
        // spent (a layer closed from its own button), which would otherwise cost a
        // press that does nothing. A page that doesn't say (not loaded yet) is
        // judged by the web view's own history.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                final WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView == null) {
                    leaveApp();
                    return;
                }
                webView.evaluateJavascript(
                    "(function(){return window.__calendarLiveBack ? window.__calendarLiveBack() : -1;})()",
                    value -> {
                        int live = -1;
                        try {
                            live = Integer.parseInt(value == null ? "" : value.trim());
                        } catch (NumberFormatException ignored) {
                            // leave it at -1: the page did not answer
                        }
                        if (live > 0 || (live < 0 && webView.canGoBack())) {
                            webView.goBack();
                        } else {
                            leaveApp();
                        }
                    }
                );
            }

            private void leaveApp() {
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
            }
        });
    }
}
