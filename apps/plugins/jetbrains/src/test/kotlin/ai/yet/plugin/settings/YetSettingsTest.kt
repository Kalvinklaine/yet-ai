package ai.yet.plugin.settings

import kotlin.test.Test
import kotlin.test.assertFalse

class YetSettingsTest {
    @Test
    fun lspEnabledDefaultsToDisabled() {
        assertFalse(YetSettingsState.State().lspEnabled)
    }
}
