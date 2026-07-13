package com.restaurante.auth.repository;

import com.restaurante.auth.entity.PasswordResetToken;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, Long> {

    Optional<PasswordResetToken> findByTokenHashAndDeletedFalse(String tokenHash);

    List<PasswordResetToken> findByUserIdAndUsedAtIsNullAndDeletedFalse(Long userId);
}
