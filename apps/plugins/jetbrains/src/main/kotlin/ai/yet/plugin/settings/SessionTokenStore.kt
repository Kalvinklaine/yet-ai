package ai.yet.plugin.settings

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service

@Service(Service.Level.APP)
class SessionTokenStore {
    private val attributes = CredentialAttributes("Yet AI local runtime session token")

    fun get(): String = PasswordSafe.instance.getPassword(attributes).orEmpty()

    fun set(value: String) {
        val token = value.trim()
        PasswordSafe.instance.set(attributes, token.takeIf { it.isNotEmpty() }?.let { Credentials("local-runtime", it) })
    }

    companion object {
        fun getInstance(): SessionTokenStore = service()
    }
}
