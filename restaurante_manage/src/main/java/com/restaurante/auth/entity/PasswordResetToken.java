package com.restaurante.auth.entity;

import com.restaurante.common.audit.BaseEntity;
import com.restaurante.user.entity.User;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * Token de recuperación de contraseña. En base de datos solo se guarda el
 * hash SHA-256 del token (nunca el valor en claro que viaja en el email):
 * un volcado de la tabla no permite usar los tokens vivos.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "password_reset_tokens")
public class PasswordResetToken extends BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "token_hash", nullable = false, unique = true, length = 64)
    private String tokenHash;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(name = "expires_at", nullable = false)
    private LocalDateTime expiresAt;

    /** null = token vivo; con valor = ya consumido o invalidado. */
    @Column(name = "used_at")
    private LocalDateTime usedAt;
}
