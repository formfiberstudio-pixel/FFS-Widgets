package com.formfiberstudio.creatortimeline;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DateFilteredPhotoPickerPlugin.class);
        registerPlugin(SharedPhotosPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
